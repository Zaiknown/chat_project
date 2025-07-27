// chat.js

document.addEventListener('DOMContentLoaded', () => {
    // --- LÓGICA DE NOTIFICAÇÃO NO TÍTULO ---
    let isWindowActive = true;
    let unreadMessages = 0;
    const originalTitle = document.title;
    window.onfocus = () => { isWindowActive = true; unreadMessages = 0; document.title = originalTitle; };
    window.onblur = () => { isWindowActive = false; };
    
    // --- Seleção dos Elementos do DOM ---
    const roomNameElement = document.getElementById('room-name');
    const userNameElement = document.getElementById('user-username');
    if (!roomNameElement || !userNameElement) { console.error('Elementos room-name ou user-username não encontrados'); return; }
    
    const roomName = JSON.parse(roomNameElement.textContent);
    const userName = JSON.parse(userNameElement.textContent);
    const chatLog = document.querySelector('#chat-log');
    const userListElement = document.querySelector('#user-list');
    const messageInput = document.querySelector('#chat-message-input');
    const messageSubmit = document.querySelector('#chat-message-submit');
    const typingIndicator = document.querySelector('#typing-indicator');

    // --- VARIÁVEIS DE ESTADO ---
    let typingTimer;
    const TYPING_TIMER_LENGTH = 2000;
    let isTyping = false;
    let typingUsers = new Set();
    let isRoomMuted = false;
    let currentUserIsAdmin = false;
    let chatSocket;

    // --- INICIALIZAÇÃO DO WEBSOCKET E HANDLERS ---
    try {
        chatSocket = new WebSocket('ws://' + window.location.host + '/ws/chat/' + roomName + '/');
    } catch (error) { console.error('Erro ao inicializar WebSocket:', error); addSystemMessage('Erro ao conectar ao chat.'); return; }

    const heartbeatInterval = setInterval(() => {
        if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
            chatSocket.send(JSON.stringify({ 'heartbeat': true }));
        }
    }, 30000);

    chatSocket.onopen = () => { console.log("Conexão WebSocket aberta!"); if (chatLog) { chatLog.scrollTop = chatLog.scrollHeight; } };
    chatSocket.onclose = (e) => {
        console.error('Chat socket fechado. Código:', e.code);
        let message = 'Você foi desconectado.';
        if (e.code === 4001) message = 'Você foi banido desta sala.';
        if (e.code === 4003) message = 'A sala atingiu o limite de usuários.';
        if (e.code === 4004) message = 'Sala não encontrada ou não existe.';
        addSystemMessage(message);
        clearInterval(heartbeatInterval);
        if (messageInput) { messageInput.disabled = true; messageInput.placeholder = 'Conexão perdida.'; }
    };
    chatSocket.onerror = (error) => { console.error('Erro no WebSocket:', error); addSystemMessage('Erro na conexão. Tente recarregar a página.'); };
    chatSocket.onmessage = function(e) {
        const data = JSON.parse(e.data);
        switch (data.type) {
            case 'room_state_update':
                isRoomMuted = data.is_muted; currentUserIsAdmin = data.is_admin; updateInputState(); break;
            case 'mute_status_update':
                isRoomMuted = data.is_muted; updateInputState(); break;
            case 'chat_message':
                if (!isWindowActive && data.username !== userName) { unreadMessages++; document.title = `(${unreadMessages}) ${originalTitle}`; }
                typingUsers.delete(data.username); updateTypingIndicator(); addChatMessage(data); break;
            case 'typing_signal':
                handleTypingSignal(data); break;
            case 'user_list_update':
                updateUserList(data.users); break;
            case 'system_message':
                if (!isWindowActive) { unreadMessages++; document.title = `(${unreadMessages}) ${originalTitle}`; }
                addSystemMessage(data.message); break;
            case 'heartbeat': break; // Ignora o pong do heartbeat no log
            default: console.warn('Tipo de mensagem desconhecido:', data.type);
        }
    };
    
    // --- FUNÇÕES DE LÓGICA E UI ---
    function updateInputState() {
        if (!messageInput) return;
        const canSpeak = !isRoomMuted || currentUserIsAdmin;
        messageInput.disabled = !canSpeak;
        messageInput.placeholder = canSpeak ? 'Digite sua mensagem...' : 'Sala silenciada.';
    }

    // ALTERADO: Função updateUserList para incluir emblemas e botões de admin
    function updateUserList(users) {
        if (!userListElement) { console.error('Elemento user-list não encontrado'); return; }
        userListElement.innerHTML = '';
        users.forEach(user => {
            const userLi = document.createElement('li');
            userLi.setAttribute('data-username', user.username);
            
            let adminIndicator = '';
            if (user.is_creator) { adminIndicator = '<span class="admin-badge creator-badge" title="Criador da Sala">👑</span>'; }
            else if (user.is_admin) { adminIndicator = '<span class="admin-badge" title="Administrador">🛡️</span>'; }

            let adminButtons = '';
            if (currentUserIsAdmin && user.username !== userName && !user.is_creator) {
                adminButtons += '<div class="admin-actions">';
                if (user.is_admin) {
                    adminButtons += `<button class="admin-btn demote-btn" data-action="demote" data-target="${user.username}" title="Rebaixar Admin">👎</button>`;
                } else {
                    adminButtons += `<button class="admin-btn promote-btn" data-action="promote" data-target="${user.username}" title="Promover a Admin">👍</button>`;
                }
                adminButtons += `<button class="admin-btn kick-btn" data-action="kick" data-target="${user.username}" title="Expulsar da Sala">❌</button>`;
                adminButtons += '</div>';
            }
            
            const userContainer = document.createElement(user.username === userName ? 'div' : 'a');
            userContainer.className = 'user-list-link';
            if (user.username !== userName) userContainer.href = `/chat/dm/${user.username}/`;
            userContainer.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <img src="${user.avatar_url}" class="chat-avatar" style="width: 25px; height: 25px; border-radius: 50%;">
                    <div>
                        <span>${user.username} ${adminIndicator}</span>
                        <small class="user-status" style="display: block; font-size: 0.75rem;">${user.is_online ? 'Online' : 'Visto ' + user.last_seen}</small>
                    </div>
                </div>
                ${adminButtons}`;
            userLi.appendChild(userContainer);
            userListElement.appendChild(userLi);
        });
    }

    function addChatMessage(data) {
        if (data.username === 'Sistema') { addSystemMessage(data.message); return; }
        const messageContainer = document.createElement('div');
        messageContainer.classList.add('chat-message', data.username === userName ? 'sent' : 'received');
        const authorHtml = data.username !== userName ? `<div class="message-author"><a href="/chat/dm/${data.username}/">${data.username}</a></div>` : '';
        messageContainer.innerHTML = `
            <img src="${data.avatar_url}" class="chat-avatar" alt="${data.username}">
            <div class="message-bubble">
                ${authorHtml}
                <div class="message-content">${data.message}</div>
                <div class="message-timestamp">${data.timestamp}</div>
            </div>`;
        if (chatLog) { chatLog.appendChild(messageContainer); chatLog.scrollTop = chatLog.scrollHeight; }
    }
    
    function addSystemMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('system-message');
        messageElement.innerText = message;
        if (chatLog) { chatLog.appendChild(messageElement); chatLog.scrollTop = chatLog.scrollHeight; }
    }
    
    function handleTypingSignal(data) {
        if (data.username === userName) return;
        data.is_typing ? typingUsers.add(data.username) : typingUsers.delete(data.username);
        updateTypingIndicator();
    }

    function updateTypingIndicator() {
        if (!typingIndicator) { console.error('Elemento typing-indicator não encontrado'); return; }
        const users = Array.from(typingUsers);
        if (users.length === 0) { typingIndicator.textContent = '\u00A0'; return; }
        typingIndicator.textContent = users.length === 1 ? `${users[0]} está digitando...` : 'Várias pessoas estão digitando...';
    }

    // --- EVENT LISTENERS ---
    if (messageInput) {
        messageInput.focus();
        messageInput.onkeyup = (e) => { if (e.key === 'Enter' && !messageInput.disabled) { messageSubmit.click(); } };
        messageInput.addEventListener('input', () => {
            if (!isTyping) {
                isTyping = true;
                if (chatSocket.readyState === WebSocket.OPEN) chatSocket.send(JSON.stringify({'is_typing': true}));
            }
            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => {
                isTyping = false;
                if (chatSocket.readyState === WebSocket.OPEN) chatSocket.send(JSON.stringify({'is_typing': false}));
            }, TYPING_TIMER_LENGTH);
        });
    }

    if (messageSubmit) {
        messageSubmit.onclick = () => {
            const message = messageInput ? messageInput.value.trim() : '';
            if (message !== '') {
                clearTimeout(typingTimer); isTyping = false;
                if (chatSocket.readyState === WebSocket.OPEN) {
                    chatSocket.send(JSON.stringify({'is_typing': false}));
                    chatSocket.send(JSON.stringify({'message': message}));
                    if (messageInput) messageInput.value = '';
                }
            }
        };
    }
    
    // SEUS LISTENERS ORIGINAIS (MANTIDOS)
    document.querySelectorAll('.kick-user-btn').forEach(btn => { /* ... sua lógica original ... */ });
    document.querySelectorAll('.promote-user-btn').forEach(btn => { /* ... sua lógica original ... */ });
    const muteRoomBtn = document.getElementById('mute-room-btn');
    if (muteRoomBtn) { muteRoomBtn.addEventListener('click', () => chatSocket.send(JSON.stringify({ 'admin_action': 'mute' }))); }
    const unmuteRoomBtn = document.getElementById('unmute-room-btn');
    if (unmuteRoomBtn) { unmuteRoomBtn.addEventListener('click', () => chatSocket.send(JSON.stringify({ 'admin_action': 'unmute' }))); }
    
    // ADICIONADO: Listener para os novos botões dinâmicos na lista de usuários
    if (userListElement) {
        userListElement.addEventListener('click', (e) => {
            const button = e.target.closest('.admin-btn');
            if (!button) return;
            e.preventDefault(); // Impede navegação se o botão estiver num link <a>
            const action = button.dataset.action;
            const target = button.dataset.target;
            if (confirm(`Tem certeza que deseja "${action}" o usuário "${target}"?`)) {
                chatSocket.send(JSON.stringify({'admin_action': action, 'target': target}));
            }
        });
    }

    window.addEventListener('beforeunload', () => { if (chatSocket && chatSocket.readyState === WebSocket.OPEN) chatSocket.send(JSON.stringify({'heartbeat': true})); });
    
    // ADICIONADO: Estilos para os novos emblemas e botões
    const style = document.createElement('style');
    style.innerHTML = `
        .user-list-link { display: flex; align-items: center; justify-content: space-between; text-decoration: none; color: inherit; padding: 5px; border-radius: 5px; }
        .user-list-link:hover { background-color: #f0f0f0; }
        .admin-badge { font-size: 0.8em; margin-left: 4px; cursor: help; }
        .admin-actions { display: flex; gap: 5px; }
        .admin-btn { background: none; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; padding: 2px 5px; font-size: 0.8rem; }
        .admin-btn:hover { background: #e9e9e9; border-color: #999; }
    `;
    document.head.appendChild(style);
});