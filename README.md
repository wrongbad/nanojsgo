# nanojsgo

A simple go server and client for users to start, play, and resume at any time go games via a browser. 

Included software (server.js, go.html) is licensed under the [GPLv2](http://www.gnu.org/licenses/gpl-2.0.html)

All files copyright [Kyle Finn](http://whoiskylefinn.com) 2014 

# How to use

1. Install node.js and socket.io

2. Run server with `nodejs server.js`

3. Adapt [example client](http://whoiskylefinn.com/jsfun/go.html) to point to your server IP

# Notes

Client code removed for now so I don't have to maintain two separate versions. In the future it may be properly modular and I'll be able to add the core components back.

# More notes

- The client creates urls with game ids in the hash or accepts pre-formed urls such as when pasted into the browser.

- The url with game id is exposed normally as the page url so a user may intuitively copy-paste it into a chat program for example.

- The server when asked for a particular game id creates a new game if necessary.

- The server caches recently requested games, and auto-saves them to backing files at every move.

- The server cache will reload games from the filesystem as needed.

# Gameplay notes

The implementation is based on AGA rules.

The server prevents suicide moves, enforces ko rule, counts kills, permanently logs every move, adds pass moves to opponent's kill count, and adds a white pass move if black plays last.

After two consecutive passes, the clients are allowed to mark some groups as dead. If the white and black team submissions match, the game ends, else the game resumes while indicating areas of dispute.

The client is responsible for tallying the score to display. The provided client uses area scoring, but the necessary information is available for a client to do territory scoring if desired.

