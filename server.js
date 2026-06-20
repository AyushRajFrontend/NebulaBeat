/* ══════════════════════════════════════════
   NEBULABEAT — SOCKET.IO MULTIPLAYER SERVER
   Low-Latency Peer-to-Peer State Sync
   
   Run:  node server.js
   Port: 3000 (or process.env.PORT)
   
   Deploy free: Railway · Render · Fly.io
   ══════════════════════════════════════════ */
const http    = require('http');
const { Server } = require('socket.io');

const PORT   = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  // Simple health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: rooms.size }));
    return;
  }
  res.writeHead(200); res.end('NebulaBeat Socket Server running ✦');
});

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

// rooms → Map<roomCode, Set<socketId>>
const rooms = new Map();

io.on('connection', socket => {
  let currentRoom = null;

  /* ── Join a room ── */
  socket.on('join', ({ room, label }) => {
    if (currentRoom) leaveRoom(socket, currentRoom);
    currentRoom = room.toLowerCase().trim();

    if (!rooms.has(currentRoom)) rooms.set(currentRoom, new Map());
    rooms.get(currentRoom).set(socket.id, { label: label || 'Explorer' });

    socket.join(currentRoom);

    // Tell everyone else a new peer joined
    socket.to(currentRoom).emit('peer_join', {
      id: socket.id,
      label,
      count: rooms.get(currentRoom).size
    });

    // Send current peer list to the new joiner
    const peers = [...rooms.get(currentRoom).entries()]
      .filter(([id]) => id !== socket.id)
      .map(([id, info]) => ({ id, ...info }));
    socket.emit('room_state', { peers, count: rooms.get(currentRoom).size });

    console.log(`[${currentRoom}] +${socket.id} (${label}) | ${rooms.get(currentRoom).size} peers`);
  });

  /* ── Galaxy events — broadcast to room (exclude sender) ── */
  socket.on('explode',    d => socket.to(currentRoom).emit('explode', d));
  socket.on('blackhole',  d => socket.to(currentRoom).emit('blackhole', d));
  socket.on('beat',       d => socket.to(currentRoom).emit('beat', d));
  socket.on('theme',      d => socket.to(currentRoom).emit('theme', d));
  socket.on('scene',      d => socket.to(currentRoom).emit('scene', d));

  /* ── WebRTC Signaling (targeted, not room-wide) ── */
socket.on('webrtc-offer', data => {
  if (!data || !data.to) return;
  io.to(data.to).emit('webrtc-offer', {
    from: socket.id,
    offer: data.offer
  });
});

socket.on('webrtc-answer', data => {
  if (!data || !data.to) return;
  io.to(data.to).emit('webrtc-answer', {
    from: socket.id,
    answer: data.answer
  });
});

socket.on('webrtc-ice', data => {
  if (!data || !data.to) return;
  io.to(data.to).emit('webrtc-ice', {
    from: socket.id,
    candidate: data.candidate
  });
});

  /* ── Disconnect ── */
  socket.on('disconnect', () => {
    if (currentRoom) leaveRoom(socket, currentRoom);
  });

  function leaveRoom(sock, room) {
    if (!rooms.has(room)) return;
    rooms.get(room).delete(sock.id);
    if (rooms.get(room).size === 0) rooms.delete(room);
    else {
      sock.to(room).emit('peer_leave', {
        id: sock.id,
        count: rooms.get(room)?.size || 0
      });
    }
    sock.leave(room);
  }
});

server.listen(PORT, () => console.log(`NebulaBeat Socket.io server → http://localhost:${PORT}`));