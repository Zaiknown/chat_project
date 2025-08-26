document.addEventListener('DOMContentLoaded', () => {
    // Variáveis de estado
    let isWindowActive = true;
    let unreadMessages = 0;
    const originalTitle = document.title;
    window.onfocus = () => { isWindowActive = true; unreadMessages = 0; document.title = originalTitle; };
    window.onblur = () => { isWindowActive = false; };

    // Elementos do DOM
    const roomNameElement = document.getElementById('room-name');
    const userNameElement = document.getElementById('user-username');
    const accessTokenElement = document.getElementById('access-token');
    if (!roomNameElement || !userNameElement) return;

    const roomName = JSON.parse(roomNameElement.textContent);
    const userName = JSON.parse(userNameElement.textContent);
    const accessToken = accessTokenElement ? JSON.parse(accessTokenElement.textContent) : null;

    const chatLog = document.querySelector('#chat-log');
    const userListElement = document.querySelector('#user-list');
    const messageInput = document.querySelector('#chat-message-input');
    const messageSubmit = document.querySelector('#chat-message-submit');
    const typingIndicator = document.querySelector('#typing-indicator');
    const modal = document.getElementById('delete-confirm-modal');
    const cancelBtn = document.getElementById('cancel-delete-btn');
    const deleteForMeBtn = document.getElementById('delete-for-me-btn');
    const deleteForEveryoneBtn = document.getElementById('delete-for-everyone-btn');
    let messageToDeleteId = null;

    const replyBar = document.getElementById('reply-bar');
    const cancelReplyBtn = document.getElementById('cancel-reply-btn');
    const replyBarUser = document.getElementById('reply-bar-user');
    const replyBarMessage = document.getElementById('reply-bar-message');
    let replyingToId = null;

    const settingsBtn = document.getElementById('settings-btn');
    const chatSettingsModal = document.getElementById('chatSettingsModal');
    const cancelSettingsBtn = document.getElementById('cancel-settings-btn');
    const chatSettingsForm = document.getElementById('chat-settings-form');
    const userManagementList = document.getElementById('user-management-list');
    const muteRoomBtn = document.getElementById('mute-room-btn');

    let currentUserList = [];
    let typingTimer;
    const TYPING_TIMER_LENGTH = 2000;
    let isTyping = false;
    let typingUsers = new Set();
    let isRoomMuted = false;
    let currentUserIsAdmin = false;
    let currentUserIsMuted = false;
    let chatSocket;
    let heartbeatInterval;

    function connect() {
        console.log('Iniciando conexão WebSocket...');
        updateUIForConnectionState(true);

        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        let url = `${protocol}://${window.location.host}/ws/chat/${roomName}/`;
        if (accessToken) {
            url += `?token=${accessToken}`;
        }

        chatSocket = new WebSocket(url);

        chatSocket.onopen = function(e) {
            console.log('Conexão WebSocket estabelecida com sucesso.');
            if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
            heartbeatInterval = setInterval(() => {
                if (chatSocket.readyState === WebSocket.OPEN) {
                    chatSocket.send(JSON.stringify({ 'heartbeat': true }));
                }
            }, 30000);
        };

        chatSocket.onclose = function(e) {
            console.error(`Socket de chat fechado (código: ${e.code}). Tentando reconectar em 2 segundos...`);
            clearInterval(heartbeatInterval);
            updateUIForConnectionState(false);

            if (e.code === 4001) {
                addSystemMessage('Você foi banido desta sala.');
                return; // Não reconecta se for banido
            }
            if (e.code === 4003) {
                addSystemMessage('A sala atingiu o limite de usuários.');
                return;
            }
            if (e.code === 4004) {
                addSystemMessage('Sala não encontrada ou não existe.');
                return;
            }
            if (e.code === 4002 && !accessToken) {
                addSystemMessage('Acesso negado. Redirecionando para a página de senha...');
                window.location.href = `/chat/room/${roomName}/`;
                return;
            }
            
            setTimeout(() => connect(), 2000);
        };

        chatSocket.onerror = function(err) {
            console.error('Erro no WebSocket:', err);
            chatSocket.close();
        };

        chatSocket.onmessage = function(e) {
            const data = JSON.parse(e.data);
            switch (data.type) {
                case 'room_state_update':
                    isRoomMuted = data.is_muted;
                    currentUserIsAdmin = data.is_admin;
                    updateInputState();
                    updateHeaderAdminButtons();
                    break;
                case 'mute_status_update':
                    isRoomMuted = data.is_muted;
                    addSystemMessage(data.message);
                    updateInputState();
                    if (muteRoomBtn) {
                        muteRoomBtn.textContent = isRoomMuted ? 'Desmutar Sala' : 'Silenciar Sala';
                    }
                    break;
                case 'admin_status_update':
                    currentUserIsAdmin = data.is_admin;
                    updateHeaderAdminButtons();
                    break;
                case 'chat_message':
                    if (!isWindowActive && data.username !== userName) {
                        unreadMessages++;
                        document.title = `(${unreadMessages}) ${originalTitle}`;
                    }
                    typingUsers.delete(data.username);
                    updateTypingIndicator();
                    addChatMessage(data);
                    break;
                case 'typing_signal':
                    handleTypingSignal(data);
                    break;
                case 'user_list_update':
                    currentUserList = data.users;
                    const currentUser = currentUserList.find(u => u.username === userName);
                    if (currentUser) {
                        currentUserIsMuted = currentUser.is_muted;
                    }
                    updateUserList(data.users);
                    updateUserManagementList(data.users);
                    updateInputState();
                    break;
                case 'user_status_update':
                    updateUserStatus(data);
                    break;
                case 'system_message':
                    if (!isWindowActive) {
                        unreadMessages++;
                        document.title = `(${unreadMessages}) ${originalTitle}`;
                    }
                    addSystemMessage(data.message);
                    break;
                case 'message_deleted_for_everyone':
                    const messageElement = document.querySelector(`[data-message-id='${data.message_id}']`);
                    if (messageElement) {
                        const messageBubble = messageElement.querySelector('.message-bubble');
                        if (data.deleted_by_admin) {
                            messageBubble.innerHTML = `<div class="message-content"><i>Essa mensagem foi apagada por um administrador (${data.admin_username})</i></div>`;
                        } else {
                            messageBubble.innerHTML = `<div class="message-content"><i>Essa mensagem foi apagada</i></div>`;
                        }
                        const optionsMenu = messageElement.querySelector('.message-options');
                        if (optionsMenu) {
                            optionsMenu.remove();
                        }
                    }
                    break;
                case 'heartbeat':
                    break;
                default:
                    console.warn('Tipo de mensagem desconhecido:', data.type);
            }
        };
    }

    function updateUIForConnectionState(isConnected) {
        if (!messageInput || !messageSubmit) return;
        if (isConnected) {
            messageInput.disabled = false;
            messageInput.placeholder = 'Digite sua mensagem...';
            messageSubmit.disabled = false;
        } else {
            messageInput.disabled = true;
            messageInput.placeholder = 'Reconectando...';
            messageSubmit.disabled = true;
        }
    }

    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
            if (!chatSocket || chatSocket.readyState === WebSocket.CLOSED) {
                console.log('Aba visível e socket fechado. Reconectando...');
                connect();
            }
        }
    });

    // --- Funções Auxiliares (copiadas do original) ---
    function updateUserStatus(data) {
        const isDM = document.querySelector('.dm-container') !== null;
        let statusElement;

        if (isDM) {
            const otherUsername = document.querySelector('.dm-username').textContent;
            if (data.username === otherUsername) {
                statusElement = document.getElementById('user-last-seen');
            }
        } else {
            const userLi = userListElement.querySelector(`li[data-username="${data.username}"]`);
            if (userLi) {
                statusElement = userLi.querySelector('.user-status');
            }
        }

        if (statusElement) {
            if (data.is_online) {
                statusElement.textContent = 'Online';
                statusElement.classList.add('online'); 
            } else {
                statusElement.textContent = `Visto ${data.last_seen}`;
                statusElement.classList.remove('online');
            }
        }
    }

    function updateHeaderAdminButtons() {
        // ... (lógica mantida)
    }

    function updateUserList(users) {
        const isDM = document.querySelector('.dm-container') !== null;
        if (isDM) {
            const otherUser = users.find(u => u.username !== userName);
            if (otherUser) {
                const lastSeenElement = document.getElementById('user-last-seen');
                if (lastSeenElement) {
                    lastSeenElement.textContent = otherUser.is_online ? 'Online' : `Visto ${otherUser.last_seen}`;
                }
            }
        } else {
            if (!userListElement) return;
            const openMenuUser = userListElement.querySelector('.menu-open')?.closest('li')?.dataset.username;
            userListElement.innerHTML = '';

            users.forEach(user => {
                const userLi = document.createElement('li');
                userLi.setAttribute('data-username', user.username);

                let adminIndicator = '';
                if (user.is_creator) {
                    adminIndicator = '<span class="admin-badge creator-badge" title="Criador da Sala">👑</span>';
                } else if (user.is_admin) {
                    adminIndicator = '<span class="admin-badge" title="Administrador">🛡️</span>';
                }

                let actionsHtml = '';
                if (user.username !== userName) {
                    const messageAction = `<a href="/chat/dm/${user.username}/" class="message-action-btn">Mensagem</a>`;
                    let adminActions = '';

                    if (currentUserIsAdmin && !user.is_creator) {
                        const promoteAction = user.is_admin
                            ? `<a href="#" class="admin-action-btn" data-action="demote" data-target="${user.username}">Rebaixar</a>`
                            : `<a href="#" class="admin-action-btn" data-action="promote" data-target="${user.username}">Promover</a>`;
                        const kickAction = `<a href="#" class="admin-action-btn" data-action="kick" data-target="${user.username}">Expulsar</a>`;
                        const muteAction = user.is_muted
                            ? `<a href="#" class="admin-action-btn" data-action="mute_user" data-target="${user.username}">Remover Silêncio</a>`
                            : `<a href="#" class="admin-action-btn" data-action="mute_user" data-target="${user.username}">Silenciar</a>`;
                        adminActions = `${promoteAction}${kickAction}${muteAction}`;
                    }

                    actionsHtml = `
                        <div class="user-actions-container">
                            <button class="more-options-btn" data-target="${user.username}">...</button>
                            <div class="actions-dropdown">
                                ${messageAction}
                                ${adminActions}
                            </div>
                        </div>
                    `;
                }

                const userContainer = document.createElement('div');
                userContainer.className = 'user-list-link';

                userContainer.innerHTML = `
                    <div class="user-info">
                        <img src="${user.avatar_url}" class="chat-avatar">
                        <div>
                            <span>${user.username} ${adminIndicator}</span>
                            <small class="user-status">${user.is_online ? 'Online' : 'Visto ' + user.last_seen}</small>
                        </div>
                    </div>
                    ${actionsHtml}
                `;
                userLi.appendChild(userContainer);
                userListElement.appendChild(userLi);
            });

            if (openMenuUser) {
                const userLi = userListElement.querySelector(`li[data-username="${openMenuUser}"]`);
                if (userLi) {
                    userLi.querySelector('.actions-dropdown')?.classList.add('visible');
                    userLi.querySelector('.user-list-link')?.classList.add('menu-open');
                }
            }
        }
    }

    function updateUserManagementList(users) {
        if (!userManagementList) return;
        userManagementList.innerHTML = '';

        users.forEach(user => {
            if (user.username === userName) return;

            const userLi = document.createElement('li');
            userLi.className = 'list-group-item d-flex justify-content-between align-items-center';
            userLi.setAttribute('data-username', user.username);

            let adminIndicator = '';
            if (user.is_creator) {
                adminIndicator = '<span class="admin-badge creator-badge" title="Criador da Sala">👑</span>';
            } else if (user.is_admin) {
                adminIndicator = '<span class="admin-badge" title="Administrador">🛡️</span>';
            }

            let adminActions = '';
            if (currentUserIsAdmin && !user.is_creator) {
                const promoteAction = user.is_admin
                    ? `<button class="btn btn-sm btn-warning admin-action-btn" data-action="demote" data-target="${user.username}">Rebaixar</button>`
                    : `<button class="btn btn-sm btn-success admin-action-btn" data-action="promote" data-target="${user.username}">Promover</button>`;
                const kickAction = `<button class="btn btn-sm btn-danger admin-action-btn" data-action="kick" data-target="${user.username}">Expulsar</button>`;
                const muteAction = user.is_muted
                    ? `<button class="btn btn-sm btn-info admin-action-btn" data-action="mute_user" data-target="${user.username}">Remover Silêncio</button>`
                    : `<button class="btn btn-sm btn-secondary admin-action-btn" data-action="mute_user" data-target="${user.username}">Silenciar</button>`;
                adminActions = `${promoteAction} ${kickAction} ${muteAction}`;
            }

            userLi.innerHTML = `
                <div>
                    <img src="${user.avatar_url}" class="chat-avatar" style="width: 25px; height: 25px; border-radius: 50%; margin-right: 10px;">
                    <span>${user.username} ${adminIndicator}</span>
                </div>
                <div>
                    ${adminActions}
                </div>
            `;
            userManagementList.appendChild(userLi);
        });
    }

    const style = document.createElement('style');
    // SUBSTITUA TODO O CONTEÚDO DE style.innerHTML POR ISTO:
    style.innerHTML = `
        /* --- ESTILOS GERAIS (MANTIDOS) --- */
        #confirmation-modal {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background-color: rgba(0, 0, 0, 0.75);
            display: flex; justify-content: center; align-items: center;
            z-index: 2000;
        }
        #confirmation-modal .modal-content {
            background-color: var(--bg-card, #fff); color: var(--text-main, #000);
            padding: 25px; border-radius: 8px; text-align: center;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        }
        #confirmation-modal p { margin-bottom: 20px; font-size: 1.1rem; }
        #confirmation-modal .modal-buttons button { margin: 0 5px; }
        #confirmation-modal .btn-secondary { background-color: #6c757d; border-color: #6c757d; }
        #confirmation-modal .btn-secondary:hover { background-color: #5a6268; border-color: #545b62; }

        /* --- ESTILOS DO SIDEBAR (MELHORADOS) --- */
        .user-list-sidebar {
            background-color: var(--bg-card);
            padding: 1rem;
            border-radius: 8px;
            border: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            height: 75vh;
        }
        .user-list-sidebar h4 {
            margin-top: 0;
            padding-bottom: 1rem;
            margin-bottom: 0.5rem;
            border-bottom: 1px solid var(--border-color);
            color: var(--text-main);
        }
        #user-list {
            list-style: none;
            padding: 0;
            margin: 0;
            overflow-y: auto;
            flex-grow: 1;
        }
        #user-list li {
            margin-bottom: 0.25rem;
        }

        /* === NOVOS ESTILOS PARA OS ITENS DA LISTA === */
        .user-list-link {
            display: flex;
            justify-content: space-between; /* Empurra os itens para as extremidades */
            align-items: center; /* Alinha verticalmente no centro */
            padding: 8px;
            border-radius: 6px;
            transition: background-color 0.2s ease;
            text-decoration: none;
            color: inherit;
        }
        .user-list-link:hover {
            background-color: var(--received-bubble-bg);
        }
        .user-list-link .user-info {
            display: flex;
            align-items: center;
            gap: 12px; /* Espaço entre a foto e o texto */
        }
        .user-list-link .chat-avatar {
            width: 35px;
            height: 35px;
            border-radius: 50%;
            object-fit: cover;
        }
        .user-list-link .user-info div {
            display: flex;
            flex-direction: column; /* Coloca o nome em cima do status */
        }
        .user-list-link .user-info span {
            font-weight: 600;
            color: var(--text-main);
            font-size: 0.9rem;
            display: flex; /* Para alinhar ícones (coroa) com o nome */
            align-items: center;
            gap: 5px;
        }
        .user-list-link .user-info small.user-status {
            font-size: 0.75rem;
            color: var(--text-secondary);
        }
        .user-actions-container {
            position: relative;
        }
    `;
    document.head.appendChild(style);

    function updateInputState() {
        if (!messageInput) return;
        const isAdmin = currentUserIsAdmin;
        const roomMuted = isRoomMuted;
        const userMuted = currentUserIsMuted;

        if (userMuted && !isAdmin) {
            messageInput.disabled = true;
            messageInput.placeholder = 'Você foi silenciado.';
        } else if (roomMuted && !isAdmin) {
            messageInput.disabled = true;
            messageInput.placeholder = 'Sala silenciada.';
        } else {
            messageInput.disabled = false;
            messageInput.placeholder = 'Digite sua mensagem...';
        }
    }

    function addChatMessage(data) {
        if (data.username === 'Sistema') {
            addSystemMessage(data.message);
            return;
        }
        const messageContainer = document.createElement('div');
        messageContainer.classList.add('chat-message', data.username === userName ? 'sent' : 'received');
        messageContainer.dataset.messageId = data.id;

        const authorHtml = data.username !== userName ? `<div class="message-author"><a href="/chat/dm/${data.username}/">${data.username}</a></div>` : '';
        
        let optionsHtml = '<div class="message-options">';
        optionsHtml += '<button class="options-toggle"><i class="fas fa-ellipsis-v"></i></button>';
        optionsHtml += '<div class="options-menu">';
        optionsHtml += '<button class="reply-btn">Responder</button>';

        if (data.username === userName) {
            optionsHtml += '<button class="delete-btn">Apagar</button>';
        }

        if (currentUserIsAdmin && data.username !== userName) {
            optionsHtml += '<button class="admin-delete-btn">Apagar (Admin)</button>';
        }

        optionsHtml += '</div></div>';

        let replyContextHtml = '';
        if (data.parent) {
            const parentAuthor = data.parent.author === userName ? 'você mesmo' : data.parent.author;
            replyContextHtml = `
                <div class="reply-context">
                    Respondendo a <strong>${parentAuthor}</strong>: 
                    <div class="reply-content">${data.parent.content}</div>
                </div>
            `;
        }

        messageContainer.innerHTML = `
            ${data.username !== userName ? `<img src="${data.avatar_url}" class="chat-avatar" alt="${data.username}">` : ''}
            <div class="message-bubble">
                ${replyContextHtml}
                ${authorHtml}
                <div class="message-content">${data.message}</div>
                <div class="message-timestamp">${data.timestamp}</div>
            </div>
            ${optionsHtml}`;
        
        if (chatLog) {
            chatLog.appendChild(messageContainer);
            chatLog.scrollTop = chatLog.scrollHeight;
        }
    }

    function addSystemMessage(message) {
        const joinMessage = `${userName} entrou na sala.`;
        if (message === joinMessage) {
            return;
        }

        const messageElement = document.createElement('div');
        messageElement.classList.add('system-message');
        messageElement.innerText = message;
        if (chatLog) {
            chatLog.appendChild(messageElement);
            chatLog.scrollTop = chatLog.scrollHeight;
        }
    }

    function handleTypingSignal(data) {
        if (data.username === userName) return;
        data.is_typing ? typingUsers.add(data.username) : typingUsers.delete(data.username);
        updateTypingIndicator();
    }

    function updateTypingIndicator() {
        if (!typingIndicator) return;
        const users = Array.from(typingUsers);
        if (users.length === 0) {
            typingIndicator.textContent = ' ';
            return;
        }
        typingIndicator.textContent = users.length === 1 ? `${users[0]} está digitando...` : 'Várias pessoas estão digitando...';
    }

    function showConfirmationModal(message, onConfirm) {
        document.querySelectorAll('.actions-dropdown.visible, .room-actions-dropdown.visible').forEach(d => d.classList.remove('visible'));
        document.querySelectorAll('.user-list-link.menu-open').forEach(link => link.classList.remove('menu-open'));

        const existingModal = document.getElementById('confirmation-modal');
        if (existingModal) existingModal.remove();

        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'confirmation-modal';
        modalOverlay.innerHTML = `
            <div class="modal-content">
                <p>${message}</p>
                <div class="modal-buttons">
                    <button id="confirm-btn" class="btn">Confirmar</button>
                    <button id="cancel-btn" class="btn btn-secondary">Cancelar</button>
                </div>
            </div>
        `;
        document.body.appendChild(modalOverlay);

        const closeModal = () => modalOverlay.remove();
        modalOverlay.querySelector('#confirm-btn').onclick = () => { onConfirm(); closeModal(); };
        modalOverlay.querySelector('#cancel-btn').onclick = closeModal;
        modalOverlay.onclick = (e) => { if (e.target === modalOverlay) closeModal(); };
    }

    // --- Event Listeners e Inicialização ---
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            chatSettingsModal.style.display = 'block';
            document.body.classList.add('modal-open');
            updateUserManagementList(currentUserList);
        });
    }

    if (cancelSettingsBtn) {
        cancelSettingsBtn.addEventListener('click', () => {
            chatSettingsModal.style.display = 'none';
            document.body.classList.remove('modal-open');
        });
    }

    if (chatSettingsForm) {
        chatSettingsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const roomNameValue = document.getElementById('room-name-input').value;
            const userLimit = document.getElementById('user-limit-input').value;

            chatSocket.send(JSON.stringify({
                'type': 'chat_settings',
                'room_name': roomNameValue,
                'user_limit': userLimit
            }));

            chatSettingsModal.style.display = 'none';
            document.body.classList.remove('modal-open');
        });
    }

    if (muteRoomBtn) {
        muteRoomBtn.addEventListener('click', () => {
            chatSocket.send(JSON.stringify({
                'type': 'admin_action',
                'action': 'toggle_mute'
            }));
        });
    }

    if (messageInput) {
        messageInput.focus();
        messageInput.onkeyup = (e) => { if (e.key === 'Enter' && !messageInput.disabled) messageSubmit.click(); };
        messageInput.addEventListener('input', () => {
            if (!isTyping) {
                isTyping = true;
                if (chatSocket.readyState === WebSocket.OPEN) chatSocket.send(JSON.stringify({ 'is_typing': true }));
            }
            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => {
                isTyping = false;
                if (chatSocket.readyState === WebSocket.OPEN) chatSocket.send(JSON.stringify({ 'is_typing': false }));
            }, TYPING_TIMER_LENGTH);
        });
    }

    if (messageSubmit) {
        messageSubmit.onclick = () => {
            const message = messageInput ? messageInput.value.trim() : '';
            if (message !== '') {
                clearTimeout(typingTimer);
                isTyping = false;
                if (chatSocket.readyState === WebSocket.OPEN) {
                    const data = {
                        'is_typing': false,
                        'message': message
                    };
                    if (replyingToId) {
                        data.reply_to = replyingToId;
                    }
                    chatSocket.send(JSON.stringify(data));
                    if (messageInput) messageInput.value = '';
                    
                    replyingToId = null;
                    replyBar.style.display = 'none';
                }
            }
        };
    }

    if (userListElement) {
        userListElement.addEventListener('click', (e) => {
            // ... (lógica mantida)
        });
    }

    document.addEventListener('click', function(e) {
        // ... (lógica mantida)
    });

    if(cancelReplyBtn) {
        cancelReplyBtn.onclick = () => {
            replyingToId = null;
            replyBar.style.display = 'none';
        };
    }

    if (chatLog) {
        chatLog.addEventListener('dblclick', function(e) {
            // ... (lógica mantida)
        });
    }

    if (modal) {
        cancelBtn.onclick = () => modal.style.display = 'none';
        window.onclick = (e) => { 
            if (e.target == modal) modal.style.display = 'none'; 
            if (e.target == chatSettingsModal) {
                chatSettingsModal.style.display = 'none';
                document.body.classList.remove('modal-open');
            }
        };

        deleteForMeBtn.onclick = () => {
            if (messageToDeleteId) {
                chatSocket.send(JSON.stringify({
                    'action': 'delete_message',
                    'message_id': messageToDeleteId,
                    'scope': 'for_me'
                }));
                modal.style.display = 'none';
            }
        };

        deleteForEveryoneBtn.onclick = () => {
            if (messageToDeleteId) {
                chatSocket.send(JSON.stringify({
                    'action': 'delete_message',
                    'message_id': messageToDeleteId,
                    'scope': 'for_everyone'
                }));
                modal.style.display = 'none';
            }
        };
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // ... (lógica mantida)
        }
    });

    window.addEventListener('beforeunload', () => {
        if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
            chatSocket.send(JSON.stringify({ 'heartbeat': true }));
        }
    });

    connect(); // Inicia a conexão
});
