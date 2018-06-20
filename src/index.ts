import * as moment from 'moment'
import * as rp from 'request-promise'
import * as fs from 'fs'
import { create } from 'domain';

const DAISY_LABEL_ID = '59c20c761314a33999b3ac50'
const DONE_LIST_ID = '5a97b723aefe03c3790e729c'
const STAGING_LIST_ID = '5a717a54c4a1139fcc118c9b'
const PRODUCTION_LIST_ID = '59c20c8962f975c2f205e9b1'
const IN_PROGRESS_LIST_ID = '59c20c847a680393ffdde8dd'

interface TrelloCredentials {
  key: string
  token: string
}

async function getData(): Promise<string> {
  const fileContents = fs.readFileSync('data/u3tO7g00.json', 'utf-8')
  const json = JSON.parse(fileContents)
  return json.name
}

function daisyCard(card: any): any {
  return card.labels.some((label: any) => {
    return label.id === DAISY_LABEL_ID
  })
}

function isString(input: string | undefined): input is string {
  return typeof input === 'string'
}

function getCredentials(): TrelloCredentials {
  const key = process.env.TRELLO_KEY
  const token = process.env.TRELLO_TOKEN
  if (!isString(key)) {
    throw new Error(`TRELLO_KEY environment variable undefined`)
  }
  if (!isString(token)) {
    throw new Error(`TRELLO_TOKEN environment variable undefined`)
  }
  return {
    key,
    token
  }
}

async function getCards(credentials: TrelloCredentials): Promise<Array<object>> {
  const getCardsOptions: rp.OptionsWithUrl = {
    url: `https://api.trello.com/1/boards/59c20c76cc6e831df3664603/cards/?key=${credentials.key}&token=${credentials.token}`,
    method: 'GET',
    json: true
  }
  return rp(getCardsOptions)
}

async function getActions(credentials: TrelloCredentials, cards: Array<object>): Promise<Array<object>> {
  const promises = cards.map(async (card: any) => {
    const getActionsOptions: rp.OptionsWithUrl = {
      url: `https://api.trello.com/1/cards/${ card.id }/actions/?key=${credentials.key}&token=${credentials.token}&filter=createCard,copyCard,updateCard`,
      method: 'GET',
      json: true
    }
    const actions = await rp(getActionsOptions)
    return {
      ...card,
      actions
    }
  })
  return Promise.all(promises)
}

function addCreation(cards: Array<object>): Array<object> {
  return cards.map((card: any) => {
    const cardActions = card.actions.filter((action: any) => action.type === 'createCard' || action.type === 'copyCard')
    const created = moment(cardActions[0] && cardActions[0].date)
    return {
      ...card,
      created
    }
  })
}

function addStarted(cards: Array<object>): Array<object> {
  return cards.map((card: any) => {
    const updates = card.actions.filter((action: any) => action.type === 'updateCard')
    const creations = card.actions.filter((action: any) => action.type === 'createCard' || action.type === 'copyCard')
    const updateStarts = updates.filter((action: any) => {
      return action.data.listAfter &&
        (action.data.listAfter.id === IN_PROGRESS_LIST_ID)
    }).map((action: any) => moment(action.date))
    const creationStarts = creations.filter((action: any) => {
      return action.data.list &&
        (action.data.list.id === IN_PROGRESS_LIST_ID)
    }).map((action: any) => moment(action.date))
    const starts = updateStarts.concat(creationStarts).sort((a: moment.Moment, b: moment.Moment) => a.diff(b))
    return {
      ...card,
      started: starts[0]
    }
  })
}

function addCompletion(cards: Array<object>): Array<object> {
  return cards.map((card: any) => {
    const cardActions = card.actions.filter((action: any) => action.type === 'updateCard')
    const completionAction = cardActions.find((action: any) => {
      return action.data.listAfter && (
        action.data.listAfter.id === STAGING_LIST_ID ||
        action.data.listAfter.id === PRODUCTION_LIST_ID ||
        action.data.listAfter.id === DONE_LIST_ID)
    })
    const completed = completionAction && moment(completionAction.date)
    return {
      ...card,
      completed
    }
  })
}

function addCycleTime(cards: Array<object>): Array<object> {
  return cards.map((card: any) => {
    const cycleTime = card.completed && moment.duration(card.completed.diff(card.created)).asDays()
    const cycleCreateStart = card.started && moment.duration(card.started.diff(card.created)).asDays()
    const cycleStartComplete = card.started && card.completed && moment.duration(card.completed.diff(card.started)).asDays()
    return {
      ...card,
      cycleTime,
      cycleCreateStart,
      cycleStartComplete
    }
  })
}

function report(cards: any): any {
  cards.forEach((card: any) => {
    console.log(card.name)
    console.log(`Card created: ${card.created.format('D.M.YYYY')}`)
    console.log(`Card started: ${card.started ? card.started.format('D.M.YYYY') : 'not started'}`)
    console.log(`Card completed: ${card.completed ? card.completed.format('D.M.YYYY') : 'uncompleted'}`)
    console.log(`Card cycle time (creation to completion): ${card.cycleTime ? card.cycleTime : 'uncompleted'}`)
    console.log(`Card cycle time (creation to start): ${card.cycleCreateStart ? card.cycleCreateStart : 'not started'}`)
    console.log(`Card cycle time (start to completion): ${card.cycleStartComplete ? card.cycleStartComplete : 'uncompleted or not started'}`)
    console.log(`\n`)
  })
}

const sum = (acc: number, value: number) => acc + value
const min = (acc: moment.Moment, value: moment.Moment) => acc.isBefore(value) ? acc : value

function meanCreateToStart(cards: any): number {
  const amount = cards.length
  const summedTime = cards.map((card: any) => card.cycleCreateStart).filter((time: number) => time).reduce(sum)
  return summedTime / amount
}

function meanStartToComplete(cards: any): number {
  const amount = cards.length
  const summedTime = cards.map((card: any) => card.cycleStartComplete).filter((time: number) => time).reduce(sum)
  return summedTime / amount
}

function meanCreateToComplete(cards: any): number {
  const amount = cards.length
  const summedCycleTime = cards.map((card: any) => card.cycleTime).filter((time: number) => time).reduce(sum)
  return summedCycleTime / amount
}

function summary(cards: any): any {
  const amount = cards.length
  const minCreationTime = cards.map((card: any) => card.created).reduce(min, cards[0].created)
  const amountOfTasksOnStartDate = cards.map((card: any) => card.created).filter((created: moment.Moment) => moment.duration(created.diff(minCreationTime)).days() === 0).length
  console.log(`SUMMARY`)
  console.log(`=======\n`)
  console.log(`Total number of tasks: ${cards.length}`)
  console.log(`Mean cycle time (creation to completion): ${meanCreateToComplete(cards)}`)
  console.log(`Mean cycle time (creation to start): ${meanCreateToStart(cards)}`)
  console.log(`Mean cycle time (start to completion): ${meanStartToComplete(cards)}`)
  console.log(`Feature started: ${minCreationTime}`)
  console.log(`Percent of tasks defined on start date: ${((amountOfTasksOnStartDate / amount) * 100).toFixed(2)}%`)
}

async function main() {
  const credentials = getCredentials()
  const cards = await getCards(credentials)
  const filteredCards = cards.filter(daisyCard)
  const actionCards = await getActions(credentials, filteredCards)
  const reportCards = addCycleTime(addCompletion(addStarted(addCreation(actionCards))))
  report(reportCards)
  summary(reportCards)
}

main()
