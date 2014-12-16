# nanojsgo

A simple go server and client for users to start, play, and resume at any time go games via a browser. 

Included software (server.js, go.html) is licensed under the GPLv2 (http://www.gnu.org/licenses/gpl-2.0.html)

All files copyright Kyle Finn 2014 

# How to use

Install node.js and socket.io

Run server with "nodejs server.js"

Edit in go.html "server-ip-goes-here" to the ip your server can be reached at.

Open go.html in a browser

# Notes

server.js does not yet enforce ko rule.

go.html/main.css were ripped out of my website and are not properly generic- it's meant more as an example client.

# More notes

The client creates urls with game ids in the hash or accepts pre-formed urls such as when pasted into the browser.
The url with game id is exposed normally as the page url so a user may intuitively copy-paste it into a chat program for example.

The server when asked for a particular game id creates a new game if necessary.
The server caches recently requested games, and auto-saves them to backing files at every move.
The server cache will reload games from the file-system as needed.

# Gameplay notes

The implementation is based on AGA rules.

The server prevents suicide moves, counts kills, permanently logs every move, adds a pass move to opponent's kill count, and adds a white pass move if black plays last.

After two consecutive passes, the clients are allowed to mark some groups as dead. If the white and black team submissions match, the game ends, else the game resumes while indicating areas of dispute.

The client is responsible for tallying the score to display. The provided client uses area scoring, but the necessary information is available for a client to do territory scoring if desired.

