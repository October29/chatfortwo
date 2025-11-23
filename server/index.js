const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const users = {};
const socketToRoom = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join room', (roomID) => {
        if (users[roomID]) {
            const length = users[roomID].length;
            if (length === 5) {
                socket.emit('room full');
                return;
            }
            users[roomID].push(socket.id);
        } else {
            users[roomID] = [socket.id];
        }
        socketToRoom[socket.id] = roomID;
        const usersInThisRoom = users[roomID].filter(id => id !== socket.id);
        socket.emit('all users', usersInThisRoom);
    });

    socket.on('sending signal', payload => {
        io.to(payload.userToSignal).emit('user joined', { signal: payload.signal, callerID: payload.callerID });
    });

    socket.on('returning signal', payload => {
        io.to(payload.callerID).emit('receiving returned signal', { signal: payload.signal, id: socket.id });
    });

    socket.on('disconnect', () => {
        const roomID = socketToRoom[socket.id];
        let room = users[roomID];
        if (room) {
            room = room.filter(id => id !== socket.id);
            users[roomID] = room;
        }
        // Notify others in room?
        // For mesh, others will detect disconnection via WebRTC state, but we can also emit.
        socket.broadcast.emit('user left', socket.id);
    });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => console.log(`server is running on port ${PORT}`));
