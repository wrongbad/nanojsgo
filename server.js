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
function opp(t) { return t=='w'?'b':'w'; }

for(var emptyboard='';emptyboard.length<19*19;emptyboard+=' ');
function gameObj(size)
{
	this.board=emptyboard,this.size=size,this.log=[],this.turn='b',this.wkills=0,this.bkills=0,this.pass=0,this.version=1;
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
	undefined:function(game) { migrations[0](game); },
	0:function(game) { game.turn=game.wturn?'w':'b'; migrations[1](game); },
	1:function(game) { game.version=1; }
};

var sendkeys=['board','lmove','size','turn','wkills','bkills','pass','bmark','wmark','qmark','mark','version'];
var savekeys=sendkeys.concat('log');
var games={};

function loadgame(id,loaded)
{
	var path='boards/'+id+'.go';
	fs.readFile(path,{encoding:'utf8'},function(err,data) {
		if(err) { loaded(0); return; }
		var game=fromjson(data);
		if(!game) { loaded(0); return; }
		game.moved=moved;
		migrations[game.version](game);
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
		game=game||new gameObj(id.indexOf('9-')==0 ? 9 : id.indexOf('13-')==0 ? 13 : 19);
		game.read=new Date().getTime();
		for(var r in socket.rooms)
			socket.leave(r);
		socket.join(id);
		games[id]=game;
		callback(game);
	}
}

function grouplib(b,s,g,lib)
{
	for(var i=0;i<s*s;i++)
		lib[i]=0,g[i]=i;
	for(var i=0;i<s*s;i++) if(b[i]!=' ')
	{
		if(i%s>0 && b[i-1]==b[i]) g[i]=g[i-1];
		if(i/s>0 && b[i-s]==b[i]) merge(g[i],g[i-s])
		if(i%s>0 && b[i-1]==' ') lib[g[i]]++;
		if(i/s>0 && b[i-s]==' ') lib[g[i]]++;
		if(i%s<s-1 && b[i+1]==' ') lib[g[i]]++;
		if(i/s<s-1 && b[i+s]==' ') lib[g[i]]++;
	}
	function merge(g1,g2)
	{
		if(g1==g2) return;
		lib[g2]+=lib[g1];
		for(var i in g)
			if(g[i]==g1)
				g[i]=g2;
	}	
}

var g_static=new Int16Array(19*19);
var lib_static=new Int8Array(19*19);
function cleardead(game,b,t)
{
	var s=game.size;
	var ord=t=='w'?'bw':'wb';
	var g=g_static;
	var lib=lib_static;
	grouplib(b,s,g,lib);
	var pts=0;
	for(var o=0;o<2;o++)
	{
		for(var i=0;i<s*s;i++)
			if(b[i]==ord[o] && lib[g[i]]==0)
				 b[i]=' ',pts++;
		if(pts>0)
			return pts*(1-2*o);
	}
	return 0;
}

function checkko(game,b)
{
	var l=game.log;
	if(l.length<2) return 0;
	var ko=0;
	var board=b.join('')+opp(game.turn);
	var hash=fnv1a(board);
	if(!game.hashes || contains(game.hashes,hash))
	{
		var turn2='b';
		var b2=(emptyboard+turn2).split('');
		game.hashes=game.hashes||[];
		for(var i=0;i<l.length;i++)
		{
			if(l[i].i>=0)
				b2[l[i].i]=l[i].v;
			cleardead(game,b2,turn2);
			turn2=opp(turn2);
			b2[19*19]=turn2;
			var board2=b2.join('');
			ko=ko||(board2==board);
			game.hashes[i]=game.hashes[i]||fnv1a(board2);
		}
	}
	return ko;
}

function trymove(game,i,v)
{
	if(game.pass>=2) return 'over';
	if(game.turn!==v) return 'turn';
	if(!(i>=0 && i<game.size*game.size)) return 'bounds';
	if(game.board[i]!=' ') return 'collision';
	
	b=game.board.split('');
	b[i]=v;
	var pts=cleardead(game,b,game.turn);
	if(pts<0) return 'suicide';
	if(checkko(game,b)) return 'ko';
	
	game.turn=='w' ? game.wkills+=pts : game.bkills+=pts;
	game.board=b.join('');
	game.moved({i:i,v:v});
	game.pass=0;
	if(game.qmark)
	{
		var newq=game.qmark.split('');
		for(var i in newq)
			if(b[i]==' ')
				newq[i]=' ';
		game.qmark=newq.join('');
	}
	return undefined;
}

function trypass(game,v)
{
	if(game.turn!==v) return 'turn';
	if(game.pass>=2) return 'turn';
	
	game.turn=='w' ? game.bkills++ : game.wkills++;
	game.moved({pass:1,v:game.turn});
	game.pass++;
	if(game.pass==2)
		delete game.qmark;
	return undefined;
}

function trymark(game,v,mark)
{
	if(v!='w' && v!='b') return 'invalid';
	if(!isstr(mark) || mark.length!=game.size*game.size) return 'invalid';
	if(game.pass!=2) return 'turn';
	
	if(v=='w' && !game.wmark)
		game.wmark=mark;
	else if(v=='b' && !game.bmark)
		game.bmark=mark;
	else
		return 'turn';
	if(game.wmark && game.bmark)
	{
		var valid=1;
		for(var i=0;i<game.wmark.length;i++)
			if('bw '.indexOf(game.wmark[i])<0)
				valid=0;
		if(game.wmark==game.bmark && valid)
		{
			game.mark=game.wmark;
			if(game.turn=='w') 
				game.bkills++;
			delete game.turn;
		}
		else
		{
			var newq=game.wmark.split('');
			for(var i in newq)
				if(game.bmark[i]!=game.wmark[i] || 'bw '.indexOf(game.wmark[i])<0)
					newq[i]='?';
			game.qmark=newq.join('');
		}
		game.pass=0;
		delete game.bmark;
		delete game.wmark;
	}
	return undefined;
}

app.listen(1369);
function handler(req,res) { res.writeHead(200); res.end('alive'); }

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