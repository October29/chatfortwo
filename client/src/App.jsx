import React, { useState, useEffect } from 'react';
import JoinRoom from './components/JoinRoom';
import ChatRoom from './components/ChatRoom';
import useWebRTC from './hooks/useWebRTC';

function App() {
  const [joined, setJoined] = useState(() => !!localStorage.getItem('chat_joined'));
  const [roomID, setRoomID] = useState(() => localStorage.getItem('chat_roomID') || '');
  const [username, setUsername] = useState(() => localStorage.getItem('chat_username') || '');

  // Only initialize hook when joined
  const { peers, messages, sendMessage, sendTyping, connectionStatus } = useWebRTC(joined ? roomID : null, joined ? username : null);

  // PWA Install Prompt
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Hide prompt after app is installed
    window.addEventListener('appinstalled', () => {
      setShowInstallPrompt(false);
      setDeferredPrompt(null);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    console.log(`User ${outcome} the install prompt`);
    setDeferredPrompt(null);
    setShowInstallPrompt(false);
  };

  const handleJoin = (room, user) => {
    setRoomID(room);
    setUsername(user);
    setJoined(true);
    localStorage.setItem('chat_joined', 'true');
    localStorage.setItem('chat_roomID', room);
    localStorage.setItem('chat_username', user);
  };

  const handleLeave = () => {
    setJoined(false);
    setRoomID('');
    setUsername('');
    localStorage.removeItem('chat_joined');
    localStorage.removeItem('chat_roomID');
    localStorage.removeItem('chat_username');
    // Hook will cleanup automatically when roomID/username becomes null
  };

  const handleChangeRoom = (newRoom) => {
    if (newRoom && newRoom !== roomID) {
      setRoomID(newRoom);
      localStorage.setItem('chat_roomID', newRoom);
    }
  };

  return (
    <>
      {/* PWA Install Prompt */}
      {showInstallPrompt && !joined && (
        <div className="fixed top-0 left-0 right-0 bg-blue-600 text-white px-4 py-3 flex items-center justify-between z-50 shadow-lg">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span className="text-sm font-medium">Install app for better experience</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleInstall}
              className="px-3 py-1 bg-white text-blue-600 rounded font-medium text-sm hover:bg-blue-50"
            >
              Install
            </button>
            <button
              onClick={() => setShowInstallPrompt(false)}
              className="px-3 py-1 text-white hover:bg-blue-700 rounded text-sm"
            >
              Later
            </button>
          </div>
        </div>
      )}

      {!joined ? (
        <JoinRoom onJoin={handleJoin} />
      ) : (
        <ChatRoom
          roomID={roomID}
          username={username}
          messages={messages}
          sendMessage={sendMessage}
          sendTyping={sendTyping}
          peers={peers}
          onLeave={handleLeave}
          onChangeRoom={handleChangeRoom}
          connectionStatus={connectionStatus}
        />
      )}
    </>
  );
}

export default App;
