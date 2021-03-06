import * as moment from 'moment'
import * as rp from 'request-promise'
import * as fs from 'fs'

const DONE_LIST_ID = '5a97b723aefe03c3790e729c'
const STAGING_LIST_ID = '5a717a54c4a1139fcc118c9b'
const PRODUCTION_LIST_ID = '59c20c8962f975c2f205e9b1'
const IN_PROGRESS_LIST_ID = '59c20c847a680393ffdde8dd'

interface TrelloCredentials {
  key: string
  token: string
}

interface TrelloLabel {
  id: string
  name: string
}

function createCardFilter(labelId: string) {
  return (card: any): any => {
    return card.labels.some((label: any) => {
      return label.id === labelId
    })
  }
}

function isString(input: string | undefined): input is string {
  return typeof input === 'string'
}

function getLabelName(): string {
  if (process.argv.length < 3) {
    throw new Error(`Label name not provided.`)
  }
  return process.argv[2]
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

async function getLabel(credentials: TrelloCredentials, labelName: string): Promise<TrelloLabel> {
  const getCardsOptions: rp.OptionsWithUrl = {
    url: `https://api.trello.com/1/boards/59c20c76cc6e831df3664603/labels/?key=${credentials.key}&token=${credentials.token}`,
    method: 'GET',
    json: true
  }
  const labels = await rp(getCardsOptions)
  return labels.find((label: TrelloLabel) => label.name === labelName)
}

async function getCards(credentials: TrelloCredentials): Promise<Array<object>> {
  const getCardsOptions: rp.OptionsWithUrl = {
    url: `https://api.trello.com/1/boards/59c20c76cc6e831df3664603/cards/all/?key=${credentials.key}&token=${credentials.token}`,
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
    const cardActions = card.actions.filter((action: any) => action.type === 'updateCard').sort((a1: any, a2: any) => moment(a1.date).diff(moment(a2.date)))
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
    console.log(card.id)
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
const max = (acc: moment.Moment, value: moment.Moment) => acc.isAfter(value) ? acc : value

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

function summary(labelName: string, cards: any): any {
  const amount = cards.length
  const minCreationTime = cards.map((card: any) => card.created).reduce(min, cards[0].created)
  const startTimes = cards.map((card: any) => card.started).filter((a: any) => a)
  const minStartTime = startTimes.reduce(min, startTimes[0])
  const completionTimes = cards.map((card: any) => card.completed).filter((a: any) => a)
  const maxCompletionTime = completionTimes.reduce(max, completionTimes[0])
  const featureStartToComplete = moment.duration(maxCompletionTime.diff(minStartTime)).asDays()
  const amountOfTasksOnStartDate = cards.map((card: any) => card.created).filter((created: moment.Moment) => moment.duration(created.diff(minCreationTime)).days() === 0).length
  const amountOfCompletedTasks = cards.map((card: any) => card.completed).filter((a: any) => a).length
  console.log(`SUMMARY`)
  console.log(`=======\n`)
  console.log(`Analysed label: ${labelName}`)
  console.log(`Total number of tasks: ${cards.length}`)
  console.log(`Mean cycle time (creation to completion): ${meanCreateToComplete(cards)}`)
  console.log(`Mean cycle time (creation to start): ${meanCreateToStart(cards)}`)
  console.log(`Mean cycle time (start to completion): ${meanStartToComplete(cards)}`)
  console.log(`Feature defined: ${minCreationTime}`)
  console.log(`Feature started: ${minStartTime}`)
  console.log(`Feature completed: ${maxCompletionTime}`)
  console.log(`Feature start to completion: ${featureStartToComplete}`)
  console.log(`Amount of completed tasks: ${amountOfCompletedTasks}`)
  console.log(`Feature cycle time divided by completed tasks: ${featureStartToComplete / amountOfCompletedTasks}`)
  console.log(`Percent of tasks defined on start date: ${((amountOfTasksOnStartDate / amount) * 100).toFixed(2)}%`)
}

async function main() {
  const labelName = getLabelName()
  const credentials = getCredentials()
  const label = await getLabel(credentials, labelName)
  const cards = await getCards(credentials)
  const filteredCards = cards.filter(createCardFilter(label.id))
  const actionCards = await getActions(credentials, filteredCards)
  const reportCards = addCycleTime(addCompletion(addStarted(addCreation(actionCards))))
  report(reportCards)
  summary(labelName, reportCards)
}

main()
