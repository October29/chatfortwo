import React, { useState, useEffect, useRef } from 'react';

import { Send, Users, LogOut, Phone, Image as ImageIcon, X } from 'lucide-react';

const ChatRoom = ({ roomID, username, messages, sendMessage, peers, onLeave }) => {
    const [newMessage, setNewMessage] = useState('');
    const [selectedImage, setSelectedImage] = useState(null);
    const [replyingTo, setReplyingTo] = useState(null);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    const scrollToMessage = (id) => {
        const element = document.getElementById(`msg-${id}`);
        if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
            element.classList.add('bg-gray-700'); // Highlight effect
            setTimeout(() => element.classList.remove('bg-gray-700'), 1000);
        }
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = (e) => {
        e.preventDefault();
        if (newMessage.trim()) {
            sendMessage(newMessage, 'text', replyingTo);
            setNewMessage('');
            setReplyingTo(null);
        }
    };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                sendMessage(reader.result, 'image', replyingTo);
                setReplyingTo(null);
            };
            reader.readAsDataURL(file);
        }
    };

    return (
        <div className="flex h-screen bg-gray-900 text-white overflow-hidden relative">
            {/* Image Modal */}
            {selectedImage && (
                <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
                    <button
                        onClick={() => setSelectedImage(null)}
                        className="absolute top-4 right-4 text-white hover:text-gray-300"
                    >
                        <X className="w-8 h-8" />
                    </button>
                    <div className="max-w-4xl max-h-full flex flex-col items-center gap-4">
                        <img src={selectedImage} alt="Full size" className="max-w-full max-h-[80vh] object-contain rounded-lg" />
                        <a
                            href={selectedImage}
                            download={`secure-chat-image-${Date.now()}.png`}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-full font-bold transition-colors"
                        >
                            Download Image
                        </a>
                    </div>
                </div>
            )}
            {/* Sidebar */}
            <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col hidden md:flex">
                <div className="p-4 border-b border-gray-700">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Users className="w-5 h-5 text-blue-400" />
                        Room: {roomID}
                    </h2>
                    <p className="text-sm text-gray-400 mt-1">Logged in as: <span className="text-blue-300">{username}</span></p>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Online Peers ({peers.length})</h3>
                    <div className="space-y-3">
                        {peers.map((peer, index) => (
                            <div key={index} className="flex items-center gap-3 bg-gray-700/50 p-2 rounded-lg">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold text-sm">
                                    {peer.username ? peer.username[0].toUpperCase() : '?'}
                                </div>
                                <span className="text-sm font-medium">{peer.username || 'Unknown'}</span>
                                <span className={`ml-auto w-2 h-2 rounded-full ${peer.connected ? 'bg-green-500' : 'bg-yellow-500'}`} title={peer.connected ? 'Connected' : 'Connecting...'}></span>
                            </div>
                        ))}
                        {peers.length === 0 && (
                            <p className="text-gray-500 text-sm italic">Waiting for peers...</p>
                        )}
                    </div>
                </div>

                <div className="p-4 border-t border-gray-700">
                    <button
                        onClick={onLeave}
                        className="w-full flex items-center justify-center gap-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 py-2 rounded-lg transition-colors"
                    >
                        <LogOut className="w-4 h-4" />
                        Leave Room
                    </button>
                </div>
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Header (Mobile only mostly) */}
                <div className="md:hidden p-4 bg-gray-800 border-b border-gray-700 flex justify-between items-center">
                    <h2 className="font-bold">Room: {roomID}</h2>
                    <button onClick={onLeave}><LogOut className="w-5 h-5 text-red-400" /></button>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-900">
                    {messages.map((msg, index) => {
                        const isMe = msg.sender === username;
                        return (
                            <div key={index} id={`msg-${msg.id}`} className={`flex ${isMe ? 'justify-end' : 'justify-start'} group transition-colors duration-500`}>
                                <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${isMe
                                    ? 'bg-blue-600 text-white rounded-br-none'
                                    : 'bg-gray-700 text-gray-100 rounded-bl-none'
                                    }`}>
                                    {!isMe && <p className="text-xs text-blue-300 mb-1 font-bold">{msg.sender}</p>}

                                    {/* Reply Context */}
                                    {msg.replyTo && (
                                        <div
                                            onClick={() => scrollToMessage(msg.replyTo.id)}
                                            className={`text-xs mb-2 p-2 rounded border-l-2 cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-2 ${isMe ? 'bg-blue-700 border-blue-300' : 'bg-gray-800 border-gray-500'}`}
                                        >
                                            {msg.replyTo.type === 'image' && (
                                                <img src={msg.replyTo.content} alt="Reply thumbnail" className="w-8 h-8 rounded object-cover" />
                                            )}
                                            <div>
                                                <p className="font-bold opacity-75">{msg.replyTo.sender}</p>
                                                <p className="truncate opacity-75 max-w-[150px]">{msg.replyTo.type === 'image' ? '📷 Image' : msg.replyTo.content}</p>
                                            </div>
                                        </div>
                                    )}

                                    {msg.type === 'image' ? (
                                        <img
                                            src={msg.content}
                                            alt="Shared"
                                            className="max-w-full rounded-lg max-h-60 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                            onClick={() => setSelectedImage(msg.content)}
                                        />
                                    ) : (
                                        <p className="break-words">{msg.content}</p>
                                    )}

                                    <div className="flex items-center justify-end gap-2 mt-1">
                                        <button
                                            onClick={() => setReplyingTo(msg)}
                                            className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-gray-300 hover:text-white"
                                        >
                                            Reply
                                        </button>
                                        <p className={`text-[10px] ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>
                                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 bg-gray-800 border-t border-gray-700">
                    {replyingTo && (
                        <div className="flex items-center justify-between bg-gray-700 p-2 rounded-t-lg mb-2 border-l-4 border-blue-500">
                            <div className="flex items-center gap-2 text-sm">
                                {replyingTo.type === 'image' && (
                                    <img src={replyingTo.content} alt="Thumbnail" className="w-10 h-10 rounded object-cover" />
                                )}
                                <div>
                                    <span className="font-bold text-blue-400">Replying to {replyingTo.sender}</span>
                                    <p className="text-gray-300 truncate max-w-xs">{replyingTo.type === 'image' ? '📷 Image' : replyingTo.content}</p>
                                </div>
                            </div>
                            <button onClick={() => setReplyingTo(null)} className="text-gray-400 hover:text-white">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    )}
                    <form onSubmit={handleSend} className="flex gap-2 max-w-4xl mx-auto items-center">
                        <label className="cursor-pointer p-3 text-gray-400 hover:text-blue-400 transition-colors">
                            <ImageIcon className="w-6 h-6" />
                            <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleFileSelect}
                            />
                        </label>
                        <input
                            type="text"
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder="Type a message..."
                            className="flex-1 bg-gray-700 border-none text-white rounded-full px-6 py-3 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        />
                        <button
                            type="submit"
                            disabled={!newMessage.trim()}
                            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white p-3 rounded-full transition-colors"
                        >
                            <Send className="w-5 h-5" />
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default ChatRoom;
