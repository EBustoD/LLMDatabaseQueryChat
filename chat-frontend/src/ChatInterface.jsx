// src/ChatInterface.jsx
import React, { useState } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import logo from './assets/orekait_logo6.png'; // Import your logo from assets
import './ChatInterface.css';

const ChatInterface = () => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!inputMessage.trim()) return;
    const newMessages = [...messages, { role: 'user', content: inputMessage }];
    setMessages(newMessages);
    setInputMessage('');
    setLoading(true);

    try {
      const response = await axios.post('http://localhost:3001/api/chat', { messages: newMessages });
      const { message, formattedMarkdown } = response.data;
      let updatedMessages = [...newMessages, message];

      if (formattedMarkdown && formattedMarkdown.trim().length > 0) {
        updatedMessages.push({ role: 'assistant', content: formattedMarkdown });
      }

      setMessages(updatedMessages);
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-page">
      <div className="chat-container">
        {/* Show header with logo only when there are messages */}
        {messages.length > 0 && (
          <header className="chat-header">
            <img src={logo} alt="App Logo" className="header-logo" />
          </header>
        )}
        {/* When no messages, display empty state with centered logo and subtitle */}
        {messages.length === 0 ? (
          <div className="empty-state">
            <img src={logo} alt="Chat Logo" className="empty-logo" />
            <p className="empty-subtitle">
              Bienvenido a Olaia, tu asistente virtual. ¿En qué puedo ayudarte hoy?
            </p>
          </div>
        ) : (
          <div className="chat-history">
            {messages.map((msg, idx) => (
              <div key={idx} className={`chat-message ${msg.role}`}>
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            ))}
            {loading && (
              <div className="chat-message assistant loading">
                <div className="spinner"></div>
              </div>
            )}
          </div>
        )}
        <div className="chat-input-container">
          <textarea
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <button onClick={handleSend} disabled={loading}>
            {loading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
