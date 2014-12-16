var app = require('http').createServer(handler)
var io = require('socket.io')(app);
var fs = require('fs');

var boards = {};
var boardHashes = {};
for(var newboard="";newboard.length<19*19;newboard+=" ");

function handler(req, res) { res.writeHead(200); res.end("alive"); }
function isstr(s) { return typeof s == 'string' || s instanceof String }
function clean(s) { return isstr(s) ? s.replace(/[^0-9A-Za-z\-]/g,"").substr(0,20) : ""; }
function fnv1a(s) { for(var a=0x811c9dc5,i=0;i<s.length;i++) {a^=s.charCodeAt(i);a=a*0x193+(a<<24);} return a>>>0; }

function loadboard(path)
{
	if(!fs.existsSync(path)) return undefined;
	var data;
	try{ data=JSON.parse(fs.readFileSync(path,{encoding:'utf8'})); } catch(err){ console.log('load board: '+err); } 
	try{ if(!data) require('child_process').exec('cp '+path+' '+path+'.x'); } catch(err){ console.log('copy bad board: '+err); }
	return data ? data : undefined;
}

function saveboard(id,board)
{
	var path='boards/'+id+'.go';
	var s;
	if(!fs.existsSync('boards'))
		fs.mkdirSync('boards', 0766, function(err){ if(err) console.log(err); });
	try{ s=JSON.stringify(board); } catch(err){ console.log('save json: '+err); }
	//console.log('save '+s+'\n to '+path+'\n');
	if(s) fs.writeFile(path,s,{encoding:'utf8'}, function(err) { if(err) console.log('save file: '+err); });
}

function getboard(socket,id)
{
	var path="boards/"+id+".go";
	var size=id.indexOf("9-")===0?9:id.indexOf("13-")===0?13:19;
	if(Object.keys(boards).length>4e4) boards={};
	var b=boards[id];
	if(!b) b=loadboard(path);
	if(!b) b={board:newboard,log:[],size:size,wturn:0,wkills:0,bkills:0};
	b.log=b.log||[];
	b.size=b.size||19;
	b.wkills=b.wkills||0;
	b.bkills=b.bkills||0;
	b.pass=b.pass||0;
	b.read=new Date().getTime();
	for(var r in socket.rooms) socket.leave(r);
	socket.join(id);
	return boards[id]=b;
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
		for(var j=0;j<s*s;j++) if(g[j]==g1) g[j]=g2;
	}	
}

var g_static=new Int16Array(19*19);
var lib_static=new Int8Array(19*19);
function cleardead(b,s,ord)
{
	var g=g_static;
	var lib=lib_static;
	var pts=0;
	grouplib(b,s,g,lib);
	for(var i=0;i<s*s;i++)
		if(b[i]==ord[0] && lib[g[i]]==0)
			 b[i]=' ',pts++;
	if(pts>0) return pts;
	for(var i=0;i<s*s;i++)
		if(b[i]==ord[1] && lib[g[i]]==0)
			 b[i]=' ',pts--;
	return pts;
}

function checkko(id,board,b)
{
	if(b.log.length<2) return 0;
	var ko=0;
	var state=board.join('')+(b.wturn?'b':'w');
	var ch=fnv1a(state);
	if(!boardHashes[id])
	{
		sim();
	}
	else
	{
		for(var i=0;i<boardHashes[id].length;i++)
		{
			if(ch==boardHashes[id][i])
			{
				sim();
				break;
			}
		}
	}
	function sim()
	{
		var t='b';
		s=(newboard+t).split('');
		boardHashes[id]=[];
		for(var i=0;i<b.log.length;i++)
		{
			if(b.log[i].i>=0)
				s[b.log[i].i]=b.log[i].v;
			if(t!=b.log[i].v)
				console.log('log turn discrepency');
			cleardead(s,b.size,t=='w'?'bw':'wb');
			t=t=='w'?'b':'w';
			s[19*19]=t;
			str=s.join('');
			if(str==state) ko=1;
			boardHashes[id][i]=fnv1a(str);
		}
	}
	/*
	for(var i=0;i<boardHashes[id].length;i++)
	console.log(i+' '+boardHashes[id][i]);
	console.log(b.log.length+' '+ch+' '+state);
	if(ko) console.log('ko.');
	 */
	return ko;
}

function trymove(id,b,i,v)
{
	if(b.pass>=2) return 'over';
	if(b.wturn&&v!='w' || !b.wturn&&v!='b') return 'turn';
	if(!(i>=0 && i<b.size*b.size)) return 'bounds';
	if(b.board[i]!=' ') return 'collision';
	
	newb=b.board.split('');
	newb[i]=v;
	var pts=cleardead(newb,b.size,b.wturn?'bw':'wb');
	if(pts<0) return 'suicide';
	if(checkko(id,newb,b)) return 'ko';
	
	if(b.wturn) b.wkills+=pts;
	if(b.bturn) b.bkills+=pts;
	b.board=newb.join('');
	b.wturn=!b.wturn;
	b.pass=0;
	if(b.qmark)
	{
		var newq=b.qmark.split('');
		for(var i=0;i<newq.length;i++) if(newb[i]==' ') newq[i]=' ';
		b.qmark=newq.join('');
	}
	if(b.log.length>4e4) b.log=['overflow'];
	b.log.push({i:i,v:v});
	if(boardHashes[id]) boardHashes[id].push(fnv1a(b.board+(b.wturn?'w':'b')));
	return undefined;
}

app.listen(1369);
io.on('connection', function(socket) {
	socket.on('getboard', function(data) {
		var id=clean(data.id);
		if(!id) return;
		var b=getboard(socket,id);
		socket.emit('game', {game: b});
	});
	socket.on('put', function(data) {
		var id=clean(data.id);
		if(!id) return;
		var b=getboard(socket,id);
		var err=trymove(id,b,data.i,data.v);
		saveboard(id,b);
		io.to(id).emit('game', {game: b, err:err});
	});
	socket.on('pass', function(data) {
		var id=clean(data.id);
		if(!id) return;
		var b=getboard(socket,id);
		if(b.wturn==(data.v=='w'))
		{
			var v=b.wturn?'w':'b';
			b.wturn?b.bkills++:b.wkills++;
			b.wturn=!b.wturn;
			b.pass++;
			b.log.push({pass:1,v:v});
			if(boardHashes[id]) boardHashes[id].push(fnv1a(b.board+(b.wturn?'w':'b')));
		}
		saveboard(id,b);
		io.to(id).emit('game', {game: b});
	});
	socket.on('markdead', function(data) {
		var id=clean(data.id);
		if(!id) return;
		if(!isstr(data.mark)) return;
		var b=getboard(socket,id);
		if(b.pass!=2) return;
		if(data.v=='w' && !b.wmark && data.mark.length==b.size*b.size)
			b.wmark=data.mark;
		if(data.v=='b' && !b.bmark && data.mark.length==b.size*b.size)
			b.bmark=data.mark;
		if(b.bmark && b.wmark)
		{
			if(b.wmark!=b.bmark)
			{
				var q=b.wmark.split('');
				for(var i=0;i<q.length;i++)
					if(q[i]!=b.bmark[i])
						q[i]='?';
				b.qmark=q.join('');
			}
			else
			{
				b.mark=b.wmark;
				if(b.wturn) b.bkills++;
				b.wturn=false;
			}
			b.pass=0;
			delete b.bmark;
			delete b.wmark;
		}
		saveboard(id,b);
		io.to(id).emit('game', {game: b});
	});
});

setInterval(purge,5e5);
function purge()
{
	if(Object.keys(boards).length<2e2) return;
	var now=new Date().getTime();
	for(b in boards)
		if(now-boards[b].read>5e5)
			delete boards[b];
}
