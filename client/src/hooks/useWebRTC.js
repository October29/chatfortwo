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
    const reconnectionAttempts = useRef({});
    const reconnectionTimers = useRef({});
    const [connectionStatus, setConnectionStatus] = useState('connecting'); // 'connected', 'connecting', 'disconnected'

    // Configuration
    // In production, use the environment variable. In dev, default to localhost.
    const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:8000';

    useEffect(() => {
        if (!roomID || !username) return;

        // Connect to signaling server
        socketRef.current = io.connect(SERVER_URL, {
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: Infinity
        });

        socketRef.current.emit('join room', roomID);

        // Handle socket connection events
        socketRef.current.on('connect', () => {
            console.log('Connected to signaling server');
            setConnectionStatus('connected');

            // Only rejoin room if we were already in one (reconnection scenario)
            // Don't rejoin on initial connect as we already emit 'join room' above
            if (socketRef.current.recovered) {
                console.log('Socket recovered, rejoining room');
                socketRef.current.emit('join room', roomID);
            }
        });

        socketRef.current.on('disconnect', () => {
            console.log('Disconnected from signaling server');
            setConnectionStatus('disconnected');
            setPeers(prev => prev.map(p => ({ ...p, connected: false })));
        });

        socketRef.current.on('reconnecting', (attemptNumber) => {
            console.log('Reconnecting to server, attempt:', attemptNumber);
            setConnectionStatus('connecting');
        });

        socketRef.current.on('all users', (users) => {
            console.log('Received all users:', users);

            // Filter out users we're already connected to
            const existingPeerIDs = peersRef.current.map(p => p.peerID);
            const newUsers = users.filter(userID => !existingPeerIDs.includes(userID));

            console.log('New users to connect:', newUsers);

            const newPeers = [];
            newUsers.forEach((userID) => {
                const peer = createPeer(userID, socketRef.current.id, socketRef.current);
                peersRef.current.push({
                    peerID: userID,
                    peer,
                    username: '',
                    status: 'active',
                    isTyping: false
                });
                newPeers.push({ peerID: userID, username: '', connected: false, status: 'active', isTyping: false });
            });

            if (newPeers.length > 0) {
                setPeers(prev => [...prev, ...newPeers]);
            }
        });

        socketRef.current.on('user joined', (payload) => {
            // Check if we already have this peer
            const existingPeer = peersRef.current.find(p => p.peerID === payload.callerID);
            if (existingPeer) {
                console.log('Peer already exists, skipping:', payload.callerID);
                return;
            }

            const peer = addPeer(payload.signal, payload.callerID, socketRef.current);
            peersRef.current.push({
                peerID: payload.callerID,
                peer,
                username: '',
                status: 'active',
                isTyping: false
            });
            setPeers(prev => {
                // Double check we're not adding a duplicate
                if (prev.find(p => p.peerID === payload.callerID)) {
                    return prev;
                }
                return [...prev, { peerID: payload.callerID, username: '', connected: false, status: 'active', isTyping: false }];
            });
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
            // Clear all reconnection timers
            Object.values(reconnectionTimers.current).forEach(timer => clearTimeout(timer));
            reconnectionTimers.current = {};
            reconnectionAttempts.current = {};

            socketRef.current.disconnect();
            peersRef.current.forEach(p => p.peer.destroy());
            peersRef.current = [];
            setPeers([]);
        };
    }, [roomID, username]);

    function handlePeerDisconnect(peerID) {
        const attempts = reconnectionAttempts.current[peerID] || 0;

        if (attempts < 5) {
            const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
            console.log(`Scheduling reconnection for ${peerID} in ${delay}ms (attempt ${attempts + 1}/5)`);

            reconnectionAttempts.current[peerID] = attempts + 1;

            reconnectionTimers.current[peerID] = setTimeout(() => {
                attemptReconnection(peerID);
            }, delay);
        } else {
            console.log(`Max reconnection attempts reached for ${peerID}`);
            setPeers(prev => prev.map(p =>
                p.peerID === peerID ? { ...p, connected: false, reconnecting: false } : p
            ));
        }
    }

    function attemptReconnection(peerID) {
        console.log(`Attempting to reconnect to ${peerID}`);

        // Check if peer still exists in room
        const peerObj = peersRef.current.find(p => p.peerID === peerID);
        if (!peerObj) {
            console.log(`Peer ${peerID} no longer in room, canceling reconnection`);
            return;
        }

        // Destroy old peer connection
        if (peerObj.peer) {
            peerObj.peer.destroy();
        }

        // Create new peer connection
        const newPeer = createPeer(peerID, socketRef.current.id, socketRef.current);
        peerObj.peer = newPeer;

        setPeers(prev => prev.map(p =>
            p.peerID === peerID ? { ...p, reconnecting: true } : p
        ));
    }

    const CHUNK_SIZE = 16 * 1024; // 16KB safe limit

    async function sendPendingMessages(peer, peerID) {
        try {
            const pendingMessages = await db.messages
                .where('roomID').equals(roomID)
                .and(msg => msg.pending === true)
                .toArray();

            if (pendingMessages.length > 0) {
                console.log(`Sending ${pendingMessages.length} pending messages to ${peerID}`);

                for (const msg of pendingMessages) {
                    try {
                        const msgString = JSON.stringify({ type: 'message', value: msg });

                        if (msgString.length > CHUNK_SIZE) {
                            // Send in chunks
                            const totalChunks = Math.ceil(msgString.length / CHUNK_SIZE);
                            for (let i = 0; i < totalChunks; i++) {
                                const chunk = msgString.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                                peer.send(JSON.stringify({
                                    type: 'chunk',
                                    id: msg.id,
                                    current: i,
                                    total: totalChunks,
                                    data: chunk
                                }));
                            }
                        } else {
                            peer.send(msgString);
                        }

                        // Mark as sent using Dexie's auto-increment id (the primary key)
                        await db.messages.update(msg.id, { pending: false });
                        console.log(`Pending message marked as delivered:`, msg.id);
                    } catch (err) {
                        console.error('Error sending pending message:', err);
                    }
                }
            }
        } catch (err) {
            console.error('Error retrieving pending messages:', err);
        }
    }

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

            // Send any pending messages
            sendPendingMessages(peer, userToSignal);
        });

        peer.on('error', (err) => {
            console.error('Peer error:', userToSignal, err);
            setPeers(prev => prev.map(p => p.peerID === userToSignal ? { ...p, connected: false } : p));
        });

        peer.on('close', () => {
            console.log('Peer connection closed:', userToSignal);
            setPeers(prev => prev.map(p => p.peerID === userToSignal ? { ...p, connected: false } : p));
            handlePeerDisconnect(userToSignal);
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
            console.log('Connected to peer (incoming):', callerID);
            setPeers(prev => prev.map(p => p.peerID === callerID ? { ...p, connected: true } : p));
            // Send our username
            peer.send(JSON.stringify({ type: 'username', value: username }));

            // Send any pending messages
            sendPendingMessages(peer, callerID);
        });

        peer.on('error', (err) => {
            console.error('Peer error:', callerID, err);
            setPeers(prev => prev.map(p => p.peerID === callerID ? { ...p, connected: false } : p));
        });

        peer.on('close', () => {
            console.log('Peer connection closed:', callerID);
            setPeers(prev => prev.map(p => p.peerID === callerID ? { ...p, connected: false } : p));
            handlePeerDisconnect(callerID);
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
            } else if (parsed.type === 'status') {
                // Update peer status
                const peerObj = peersRef.current.find(p => p.peerID === peerID);
                if (peerObj) {
                    peerObj.status = parsed.value;
                }
                setPeers(prev => prev.map(p => p.peerID === peerID ? { ...p, status: parsed.value } : p));
            } else if (parsed.type === 'typing') {
                // Update peer typing status
                setPeers(prev => prev.map(p => p.peerID === peerID ? { ...p, isTyping: parsed.value } : p));
            } else if (parsed.type === 'ping') {
                // Respond to ping with pong
                const peerObj = peersRef.current.find(p => p.peerID === peerID);
                if (peerObj && peerObj.peer) {
                    try {
                        peerObj.peer.send(JSON.stringify({
                            type: 'pong',
                            timestamp: parsed.timestamp
                        }));
                    } catch (e) {
                        console.error('Error sending pong:', e);
                    }
                }
            } else if (parsed.type === 'pong') {
                // Calculate latency
                const latency = Date.now() - parsed.timestamp;
                console.log(`Latency to ${peerID}: ${latency}ms`);

                if (latency > 2000) {
                    console.warn(`High latency detected: ${latency}ms`);
                }
            } else if (parsed.type === 'message') {
                // Save to DB
                db.messages.add({
                    ...parsed.value,
                    roomID // Add roomID so we can filter
                });

                // Trigger notification if backgrounded or not focused
                if ((document.hidden || !document.hasFocus()) && Notification.permission === 'granted') {
                    console.log('Triggering notification for:', parsed.value.sender);
                    console.log('Notification permission:', Notification.permission);
                    console.log('Document hidden:', document.hidden);
                    console.log('Has focus:', document.hasFocus());

                    try {
                        const notification = new Notification(`New message from ${parsed.value.sender}`, {
                            body: parsed.value.type === 'image' ? 'Sent an image' : parsed.value.content,
                            icon: '/vite.svg',
                            badge: '/vite.svg',
                            tag: 'chat-message', // Reuse notification tag
                            requireInteraction: false,
                            silent: false
                        });

                        // Add click handler to focus the window
                        notification.onclick = () => {
                            window.focus();
                            notification.close();
                        };

                        console.log('Notification created successfully');

                        // Vibrate on mobile if supported
                        if ('vibrate' in navigator) {
                            navigator.vibrate([200, 100, 200]);
                        }
                    } catch (err) {
                        console.error('Notification error:', err);
                        console.error('Error details:', err.message, err.stack);

                        // Fallback: try vibration only
                        if ('vibrate' in navigator) {
                            navigator.vibrate([200, 100, 200]);
                        }
                    }
                }
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

    const sendMessage = (content, type = 'text', replyTo = null) => {
        const msgID = Date.now() + Math.random().toString(36).substr(2, 9);

        // Check if we have any connected peers
        const connectedPeers = peersRef.current.filter(p => p.peer && p.peer.connected);
        const hasPeers = connectedPeers.length > 0;

        const msg = {
            id: msgID,
            sender: username,
            content,
            type,
            replyTo,
            timestamp: Date.now()
        };

        const msgString = JSON.stringify({ type: 'message', value: msg });

        // Try to send to connected peers
        if (hasPeers) {
            connectedPeers.forEach(p => {
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
        } else {
            console.log('No peers connected, message queued as pending');
        }

        // Add to local DB with pending flag
        db.messages.add({
            ...msg,
            roomID,
            pending: !hasPeers // Mark as pending if no connected peers
        });
    };

    const sendStatus = (status) => {
        peersRef.current.forEach(p => {
            try {
                p.peer.send(JSON.stringify({ type: 'status', value: status }));
            } catch (e) {
                console.error('Error sending status:', e);
            }
        });
    };

    const sendTyping = (isTyping) => {
        peersRef.current.forEach(p => {
            try {
                p.peer.send(JSON.stringify({ type: 'typing', value: isTyping }));
            } catch (e) {
                console.error('Error sending typing status:', e);
            }
        });
    };

    // Track visibility/focus
    useEffect(() => {
        const handleFocus = () => {
            console.log('Window focused');
            sendStatus('active');
        };

        const handleBlur = () => {
            console.log('Window blurred');
            sendStatus('away');
        };

        window.addEventListener('focus', handleFocus);
        window.addEventListener('blur', handleBlur);

        // Also handle visibility change as a backup
        const handleVisibilityChange = () => {
            if (document.hidden) {
                console.log('Document hidden');
                sendStatus('away');
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('blur', handleBlur);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [peers]); // Re-bind when peers change to ensure we send to all

    // Heartbeat mechanism
    useEffect(() => {
        const heartbeatInterval = setInterval(() => {
            peersRef.current.forEach(p => {
                if (p.peer && p.peer.connected) {
                    try {
                        p.peer.send(JSON.stringify({
                            type: 'ping',
                            timestamp: Date.now()
                        }));
                    } catch (e) {
                        console.error('Error sending heartbeat:', e);
                    }
                }
            });
        }, 15000); // Send heartbeat every 15 seconds

        return () => clearInterval(heartbeatInterval);
    }, []);

    return { peers, messages, sendMessage, sendTyping, connectionStatus };
};

export default useWebRTC;
