import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import SimplePeer from 'simple-peer';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';

const useWebRTC = (roomID, username) => {
    const [peers, setPeers] = useState([]);
    // Use live query to get messages from DB automatically
    const messages = useLiveQuery(
        () => roomID ? db.messages.where('roomID').equals(roomID).sortBy('timestamp') : [],
        [roomID]
    ) || [];

    const socketRef = useRef();
    const peersRef = useRef([]); // Array of { peerID, peer, username }

    // Configuration
    // In production, use the environment variable. In dev, default to localhost.
    const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:8000';

    useEffect(() => {
        if (!roomID || !username) return;

        // Connect to signaling server
        socketRef.current = io.connect(SERVER_URL);

        socketRef.current.emit('join room', roomID);

        socketRef.current.on('all users', (users) => {
            const peers = [];
            users.forEach((userID) => {
                const peer = createPeer(userID, socketRef.current.id, socketRef.current);
                peersRef.current.push({
                    peerID: userID,
                    peer,
                    username: ''
                });
                peers.push({ peerID: userID, username: '', connected: false });
            });
            setPeers(peers);
        });

        socketRef.current.on('user joined', (payload) => {
            const peer = addPeer(payload.signal, payload.callerID, socketRef.current);
            peersRef.current.push({
                peerID: payload.callerID,
                peer,
                username: ''
            });
            setPeers(prev => [...prev, { peerID: payload.callerID, username: '', connected: false }]);
        });

        socketRef.current.on('receiving returned signal', (payload) => {
            const item = peersRef.current.find((p) => p.peerID === payload.id);
            item.peer.signal(payload.signal);
        });

        socketRef.current.on('user left', (id) => {
            const peerObj = peersRef.current.find(p => p.peerID === id);
            if (peerObj) {
                peerObj.peer.destroy();
            }
            const peers = peersRef.current.filter(p => p.peerID !== id);
            peersRef.current = peers;
            setPeers(prev => prev.filter(p => p.peerID !== id));
        });

        return () => {
            socketRef.current.disconnect();
            peersRef.current.forEach(p => p.peer.destroy());
            peersRef.current = [];
            setPeers([]);
            // setMessages([]); // Don't clear messages, they are from DB
        };
    }, [roomID, username]);

    function createPeer(userToSignal, callerID, socket) {
        const peer = new SimplePeer({
            initiator: true,
            trickle: false,
            stream: false, // No video/audio
        });

        peer.on('signal', (signal) => {
            socket.emit('sending signal', { userToSignal, callerID, signal });
        });

        peer.on('connect', () => {
            console.log('Connected to peer:', userToSignal);
            setPeers(prev => prev.map(p => p.peerID === userToSignal ? { ...p, connected: true } : p));
            // Send our username
            peer.send(JSON.stringify({ type: 'username', value: username }));
        });

        peer.on('error', (err) => {
            console.error('Peer error:', userToSignal, err);
        });

        peer.on('data', (data) => {
            handleData(data, userToSignal);
        });

        return peer;
    }

    function addPeer(incomingSignal, callerID, socket) {
        const peer = new SimplePeer({
            initiator: false,
            trickle: false,
            stream: false,
        });

        peer.on('signal', (signal) => {
            socket.emit('returning signal', { signal, callerID });
        });

        peer.on('connect', () => {
            console.log('Connected to peer:', callerID);
            setPeers(prev => prev.map(p => p.peerID === callerID ? { ...p, connected: true } : p));
            // Send our username
            peer.send(JSON.stringify({ type: 'username', value: username }));
        });

        peer.on('error', (err) => {
            console.error('Peer error:', callerID, err);
        });

        peer.on('data', (data) => {
            handleData(data, callerID);
        });

        peer.signal(incomingSignal);

        return peer;
    }

    // Buffer for reassembling chunks
    const chunksRef = useRef({}); // { peerID: { messageID: [chunks] } }

    function handleData(data, peerID) {
        try {
            const parsed = JSON.parse(data.toString());

            if (parsed.type === 'chunk') {
                handleChunk(parsed, peerID);
                return;
            }

            if (parsed.type === 'username') {
                // Update peer username
                const peerObj = peersRef.current.find(p => p.peerID === peerID);
                if (peerObj) {
                    peerObj.username = parsed.value;
                }
                setPeers(prev => prev.map(p => p.peerID === peerID ? { ...p, username: parsed.value } : p));
            } else if (parsed.type === 'message') {
                // Save to DB
                db.messages.add({
                    ...parsed.value,
                    roomID // Add roomID so we can filter
                });
            }
        } catch (e) {
            console.error('Error parsing data:', e);
        }
    }

    function handleChunk(chunkData, peerID) {
        const { id, current, total, data } = chunkData;

        if (!chunksRef.current[peerID]) chunksRef.current[peerID] = {};
        if (!chunksRef.current[peerID][id]) chunksRef.current[peerID][id] = [];

        chunksRef.current[peerID][id][current] = data;

        // Check if we have all chunks
        const chunks = chunksRef.current[peerID][id];
        if (Object.keys(chunks).length === total) {
            // Reassemble
            const fullData = chunks.join('');
            delete chunksRef.current[peerID][id];

            // Process the full message
            try {
                const parsed = JSON.parse(fullData);
                if (parsed.type === 'message') {
                    db.messages.add({
                        ...parsed.value,
                        roomID
                    });
                }
            } catch (e) {
                console.error('Error reassembling message:', e);
            }
        }
    }

    const CHUNK_SIZE = 16 * 1024; // 16KB safe limit

    const sendMessage = (content, type = 'text', replyTo = null) => {
        const msgID = Date.now() + Math.random().toString(36).substr(2, 9);
        const msg = {
            id: msgID,
            sender: username,
            content,
            type,
            replyTo,
            timestamp: Date.now()
        };

        const msgString = JSON.stringify({ type: 'message', value: msg });

        // Send to all peers
        peersRef.current.forEach(p => {
            try {
                if (msgString.length > CHUNK_SIZE) {
                    // Send in chunks
                    const totalChunks = Math.ceil(msgString.length / CHUNK_SIZE);
                    for (let i = 0; i < totalChunks; i++) {
                        const chunk = msgString.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                        p.peer.send(JSON.stringify({
                            type: 'chunk',
                            id: msgID,
                            current: i,
                            total: totalChunks,
                            data: chunk
                        }));
                    }
                } else {
                    p.peer.send(msgString);
                }
            } catch (e) {
                console.error('Error sending to peer:', e);
            }
        });

        // Add to local DB
        db.messages.add({
            ...msg,
            roomID
        });
    };

    return { peers, messages, sendMessage };
};

export default useWebRTC;
