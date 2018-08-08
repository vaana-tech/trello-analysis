Trello Analysis
===============

This is a utility script to analyse cycle times of trello tasks of certain features. Tasks are grouped to features using a Trello label.

Usage
-----

```
TRELLO_KEY=<access_key> TRELLO_TOKEN=<token> npm run analysis -- <label_name>
```
Where `access_key` is the key to gain access to the associated trello board data through [Trello API](https://developers.trello.com/v1.0/reference) and `token` is the token for the same access.

`label_name` is the name of the label to analyse.

