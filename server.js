var app = require('http').createServer(handler)
var io = require('socket.io')(app);
var fs = require('fs');

function isstr(s) { return (typeof s)=='string'||(s instanceof String); }
function safestr(s) { return isstr(s) ? s.replace(/[^0-9A-Za-z\-]/g,"").substr(0,20) : ""; }
function fnv1a(s) { for(var a=0x811c9dc5,i=0;i<s.length;i++) { a^=s.charCodeAt(i); a=a*0x193+(a<<24); } return a>>>0; }
function contains(arr,o) { for(var i=0;i<arr.length;i++) { if(arr[i]==o) return true; } return false; }
function get(o,k) { for(var i=0,o2={};i<k.length;i++) { o2[k[i]]=o[k[i]]; } return o2; }
function errpre(pre) { return function(err){ if(err) console.log(pre+'::'+err); }; }
function tojson(o) { try { return JSON.stringify(o); } catch(err) { console.log('tojson::'+err+' '+o); return null; } }
function fromjson(o) { try { return JSON.parse(o); } catch(err) { console.log('fromjson::'+err+' '+o); return null; } }
function setroom(socket,room) { for(var r in socket.rooms) { socket.leave(r); } socket.join(room); }
function opp(t) { return t==='w'?'b':'w'; }

for(var emptyboard='';emptyboard.length<19*19;emptyboard+=' ');
function gameObj(size)
{
	this.board=emptyboard;
	this.size=size;
	this.log=[];
	this.turn='b';
	this.wkills=0;
	this.bkills=0;
	this.pass=0;
	this.version=2;
	this.moved=moved;
}
function moved(o) { 
	if(this.log.length>3e3)
		console.log('log>3e3'),this.log=[];
	this.log.push(this.lmove=o);
	this.turn=opp(this.turn); 
	if(this.hashes) 
		this.hashes.push(fnv1a(this.board+this.turn));
};

var migrations={
	undefined:function(game) { 
		migrations[0](game);
	},
	0:function(game) { 
		game.turn=game.wturn?'w':'b';
		migrations[1](game); 
	},
	1:function(game) { 
		if(game.mark) delete game.turn;
		game.mark=game.mark||game.qmark;
		migrations[2](game);
	},
	2:function(game) { 
		game.version=2;
	}
};

var sendkeys=['board','lmove','size','turn','wkills','bkills','pass','bmark','wmark','mark','version'];
var savekeys=sendkeys.concat('log');
var games={};

function loadgame(id,loaded)
{
	var path='boards/'+id+'.go';
	fs.readFile(path,{encoding:'utf8'},function(err,data) {
		if(err) { loaded(0); return; }
		var game=fromjson(data);
		if(!game) { loaded(0); return; }
		migrations[game.version](game);
		game.moved=moved;
		loaded(game);
	});
}

function savegame(id,board)
{
	var path='boards/'+id+'.go';
	if(!fs.existsSync('boards'))
		fs.mkdirSync('boards',0766,errpre('mkdir'));
	var s=tojson(get(board,savekeys));
	fs.writeFile(path,s,{encoding:'utf8'},errpre('save'));
}

function getgame(socket,id,callback)
{
	if(games[id])
		loaded(games[id]);
	else
		loadgame(id,loaded);
	function loaded(game)
	{
		games[id]=game||new gameObj(id.indexOf('9-')==0 ? 9 : id.indexOf('13-')==0 ? 13 : 19);
		games[id].read=new Date().getTime();
		setroom(socket,id);
		callback(games[id]);
	}
}

function groupcount(boardA,size,groups,liberties)
{
	var s=size;
	for(var i=0;i<s*s;i++)
	{
		liberties[i]=0
		groups[i]=i;
	}
	for(var i=0;i<s*s;i++)
	{
		if(boardA[i]!=' ')
		{
			if(i%s>0 && boardA[i-1]==boardA[i]) groups[i]=groups[i-1];
			if(i/s>0 && boardA[i-s]==boardA[i]) merge(groups[i],groups[i-s]);
			if(i%s>0 && boardA[i-1]==' ') liberties[groups[i]]++;
			if(i/s>0 && boardA[i-s]==' ') liberties[groups[i]]++;
			if(i%s<s-1 && boardA[i+1]==' ') liberties[groups[i]]++;
			if(i/s<s-1 && boardA[i+s]==' ') liberties[groups[i]]++;
		}
	}
	function merge(groupFrom,groupTo)
	{
		if(groupFrom==groupTo) return;
		liberties[groupTo]+=liberties[groupFrom];
		for(var i=0;i<s*s;i++)
			if(groups[i]==groupFrom)
				groups[i]=groupTo;
	}	
}

var g_static=new Int16Array(19*19);
var lib_static=new Int8Array(19*19);
function cleardead(boardA,size,turn)
{
	var groups=g_static;
	var liberties=lib_static;
	groupcount(boardA,size,groups,liberties);
	var points=0;
	for(var o=0;o<2;o++)
	{
		turn=opp(turn);
		for(var i=0;i<size*size;i++)
			if(boardA[i]==turn && liberties[groups[i]]==0)
				 boardA[i]=' ',points++;
		if(points>0)
			return points*[1,-1][o];
	}
	return 0;
}

function checkko(game,boardA)
{
	if(game.log.length<2) return 0;
	var ko=0;
	var board=boardA.join('')+opp(game.turn);
	var hash=fnv1a(board);
	if(!game.hashes || contains(game.hashes,hash))
	{
		var turn2='b';
		var boardA2=(emptyboard+turn2).split('');
		game.hashes=game.hashes||[];
		for(var i=0;i<game.log.length;i++)
		{
			if(game.log[i].i>=0)
				boardA2[game.log[i].i]=game.log[i].v;
			cleardead(boardA2,game.size,turn2);
			turn2=opp(turn2);
			boardA2[19*19]=turn2;
			var board2=boardA2.join('');
			ko=ko||(board2==board);
			game.hashes[i]=game.hashes[i]||fnv1a(board2);
		}
	}
	return ko;
}

function trymove(game,location,team)
{
	if(team!=='w' && team!=='b') return 'invalid';
	if(game.turn!==team) return 'turn';
	if(game.pass>=2) return 'turn';
	if(!(location>=0 && location<game.size*game.size)) return 'bounds';
	if(game.board[location]!=' ') return 'collision';
	
	boardA=game.board.split('');
	boardA[location]=team;
	var pts=cleardead(boardA,game.size,game.turn);
	if(pts<0) return 'suicide';
	if(checkko(game,boardA)) return 'ko';
	
	game.turn=='w' ? game.wkills+=pts : game.bkills+=pts;
	game.board=boardA.join('');
	game.moved({i:location,v:team});
	game.pass=0;
	if(game.qmark)
	{
		var qmarkA=game.qmark.split('');
		for(var i=0;i<game.size*game.size;i++)
			if(boardA[i]==' ')
				qmarkA[i]=' ';
		game.qmark=qmarkA.join('');
	}
	return undefined;
}

function trypass(game,team)
{
	if(team!=='w' && team!=='b') return 'invalid';
	if(game.turn!=team) return 'turn';
	if(game.pass>=2) return 'turn';
	
	game.turn=='w' ? game.bkills++ : game.wkills++;
	game.moved({pass:1,v:game.turn});
	game.pass++;
	if(game.pass==2)
		delete game.mark;
	return undefined;
}

function trymark(game,team,mark)
{
	if(team!=='w' && team!=='b') return 'invalid';
	if(!isstr(mark) || mark.length!=game.size*game.size) return 'invalid';
	if(game.pass!=2) return 'turn';
	
	if(team=='w' && !game.wmark)
		game.wmark=mark;
	else if(team=='b' && !game.bmark)
		game.bmark=mark;
	else
		return 'turn';
	if(game.wmark && game.bmark)
	{
		var markA=game.wmark.split('');
		for(var i in markA)
			if(game.bmark[i]!=game.wmark[i] || !contains('d ',game.wmark[i]))
				markA[i]='?';
		game.mark=markA.join('');
		if(!contains(game.mark,'?'))
		{
			if(game.turn=='w')
				game.bkills++;
			delete game.turn;
		}
		game.pass=0;
		delete game.bmark;
		delete game.wmark;
	}
	return undefined;
}

app.listen(1369);
function handler(request,response) { response.writeHead(200); response.end('alive'); }

io.on('connection', function(socket) {
	socket.on('get', function(data) {
		var id=safestr(data.id);
		if(!id) return;
		getgame(socket,id,function(game) {
			if(!game) return;
			socket.emit('game', {game:get(game,sendkeys)});
		});
	});
	socket.on('put', function(data) {
		var id=safestr(data.id);
		if(!id) return;
		getgame(socket,id,function(game) {
			if(!game) return;
			var err=trymove(game,data.i,data.v);
			if(err) console.log(err);
			savegame(id,game);
			io.to(id).emit('game', {game:get(game,sendkeys), err:err});
		});
	});
	socket.on('pass', function(data) {
		var id=safestr(data.id);
		if(!id) return;
		getgame(socket,id,function(game) {
			if(!game) return;
			var err=trypass(game,data.v);
			if(err) console.log(err);
			savegame(id,game);
			io.to(id).emit('game', {game:get(game,sendkeys), err:err});	  
		});
	});
	socket.on('markdead', function(data) {
		var id=safestr(data.id);
		if(!id) return;
		getgame(socket,id,function(game) {
			if(!game) return;
			var err=trymark(game,data.v,data.mark);
			if(err) console.log(err);
			savegame(id,game);
			io.to(id).emit('game', {game:get(game,sendkeys), err:err});
		});
	});
});

setInterval(function() {
	var ids=Object.keys(games);
	if(ids.length<3e3) return;
	var recent=function(a,b) { return games[a].read>games[b].read?-1:1; };
	var keep=ids.sort(recent).slice(0,2e3);
	games=get(games,keep);
	console.log('cache clean');
}, 5e5);