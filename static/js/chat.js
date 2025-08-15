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
    if (!roomNameElement || !userNameElement) return;

    const roomName = JSON.parse(roomNameElement.textContent);
    const userName = JSON.parse(userNameElement.textContent);
    const chatLog = document.querySelector('#chat-log');
    const userListElement = document.querySelector('#user-list');
    const messageInput = document.querySelector('#chat-message-input');
    const messageSubmit = document.querySelector('#chat-message-submit');
    const typingIndicator = document.querySelector('#typing-indicator');
    // --- ELEMENTOS PARA DELEÇÃO ---
    const modal = document.getElementById('delete-confirm-modal');
    const cancelBtn = document.getElementById('cancel-delete-btn');
    const deleteForMeBtn = document.getElementById('delete-for-me-btn');
    const deleteForEveryoneBtn = document.getElementById('delete-for-everyone-btn');
    let messageToDeleteId = null;

    // --- ELEMENTOS PARA RESPOSTA ---
    const replyBar = document.getElementById('reply-bar');
    const cancelReplyBtn = document.getElementById('cancel-reply-btn');
    const replyBarUser = document.getElementById('reply-bar-user');
    const replyBarMessage = document.getElementById('reply-bar-message');
    let replyingToId = null;

    // Estado do WebSocket e do Chat
    let typingTimer;
    const TYPING_TIMER_LENGTH = 2000;
    let isTyping = false;
    let typingUsers = new Set();
    let isRoomMuted = false;
    let currentUserIsAdmin = false;
    let chatSocket;

    // --- Conexão WebSocket ---
    try {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        chatSocket = new WebSocket(`${protocol}://${window.location.host}/ws/chat/${roomName}/`);
    } catch (error) {
        addSystemMessage('Erro ao conectar ao chat.');
        return;
    }

    const heartbeatInterval = setInterval(() => {
        if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
            chatSocket.send(JSON.stringify({ 'heartbeat': true }));
        }
    }, 30000);

    chatSocket.onopen = () => { if (chatLog) chatLog.scrollTop = chatLog.scrollHeight; };
    chatSocket.onclose = (e) => {
        let message = 'Você foi desconectado.';
        if (e.code === 4001) message = 'Você foi banido desta sala.';
        if (e.code === 4003) message = 'A sala atingiu o limite de usuários.';
        if (e.code === 4004) message = 'Sala não encontrada ou não existe.';
        addSystemMessage(message);
        clearInterval(heartbeatInterval);
        if (messageInput) {
            messageInput.disabled = true;
            messageInput.placeholder = 'Conexão perdida.';
        }
    };
    chatSocket.onerror = () => addSystemMessage('Erro na conexão. Tente recarregar a página.');

    // --- Manipulador de Mensagens ---
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
                updateUserList(data.users);
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
                    // Remove o menu de opções, se existir
                    const optionsMenu = messageElement.querySelector('.message-options');
                    if (optionsMenu) {
                        optionsMenu.remove();
                    }
                }
                break;
            case 'heartbeat':
                break; // Apenas para manter a conexão viva
            default:
                console.warn('Tipo de mensagem desconhecido:', data.type);
        }
    };

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

    // --- Funções de Atualização da UI ---

    function updateHeaderAdminButtons() {
        const roomActionsContainer = document.getElementById('room-actions-container');
        if (!roomActionsContainer) return;

        roomActionsContainer.innerHTML = ''; // Limpa ações antigas

        if (currentUserIsAdmin) {
            const settingsBtn = document.createElement('button');
            settingsBtn.className = 'room-settings-btn';
            settingsBtn.innerHTML = '⚙️'; // Ícone de engrenagem
            settingsBtn.title = 'Configurações da Sala';

            const dropdown = document.createElement('div');
            dropdown.className = 'room-actions-dropdown';
            dropdown.innerHTML = `
                <a href="#" id="mute-room-btn">Silenciar Sala</a>
                <a href="#" id="unmute-room-btn">Reativar Sala</a>
            `;

            roomActionsContainer.appendChild(settingsBtn);
            roomActionsContainer.appendChild(dropdown);

            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.classList.toggle('visible');
            });

            document.getElementById('mute-room-btn').addEventListener('click', (e) => {
                e.preventDefault();
                chatSocket.send(JSON.stringify({ 'admin_action': 'mute' }));
                dropdown.classList.remove('visible');
            });

            document.getElementById('unmute-room-btn').addEventListener('click', (e) => {
                e.preventDefault();
                chatSocket.send(JSON.stringify({ 'admin_action': 'unmute' }));
                dropdown.classList.remove('visible');
            });
        }
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
                        adminActions = `${promoteAction}${kickAction}`;
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

    function updateInputState() {
        if (!messageInput) return;
        const canSpeak = !isRoomMuted || currentUserIsAdmin;
        messageInput.disabled = !canSpeak;
        messageInput.placeholder = canSpeak ? 'Digite sua mensagem...' : 'Sala silenciada.';
    }

    function addChatMessage(data) {
        if (data.username === 'Sistema') {
            addSystemMessage(data.message);
            return;
        }
        const messageContainer = document.createElement('div');
        messageContainer.classList.add('chat-message', data.username === userName ? 'sent' : 'received');
        messageContainer.dataset.messageId = data.id; // Adiciona o ID da mensagem

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
            return; // Não exibe a mensagem se for o próprio usuário entrando
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
            typingIndicator.textContent = ' '; // Non-breaking space
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
                    
                    // Reset reply state
                    replyingToId = null;
                    replyBar.style.display = 'none';
                }
            }
        };
    }

    if (userListElement) {
        userListElement.addEventListener('click', (e) => {
            const moreOptionsBtn = e.target.closest('.more-options-btn');
            const actionBtn = e.target.closest('.admin-action-btn');
            const messageBtn = e.target.closest('.message-action-btn');

            if (moreOptionsBtn) {
                e.preventDefault();
                const dropdown = moreOptionsBtn.nextElementSibling;
                const userLink = moreOptionsBtn.closest('.user-list-link');
                const isVisible = dropdown.classList.contains('visible');

                document.querySelectorAll('.actions-dropdown.visible').forEach(d => d.classList.remove('visible'));
                document.querySelectorAll('.user-list-link.menu-open').forEach(link => link.classList.remove('menu-open'));

                if (!isVisible) {
                    dropdown.classList.add('visible');
                    userLink.classList.add('menu-open');
                }

            } else if (actionBtn) {
                e.preventDefault();
                const { action, target } = actionBtn.dataset;
                const actionText = actionBtn.textContent;
                showConfirmationModal(`Tem certeza que deseja "${actionText}" o usuário "${target}"?`, () => {
                    chatSocket.send(JSON.stringify({ 'admin_action': action, 'target': target }));
                });

            } else if (messageBtn) {
                // A ação de mensagem agora é um link direto, então o comportamento padrão do navegador (navegar para o href) é suficiente.
                // Nenhuma ação extra de JavaScript é necessária aqui.
            }
        });
    }

    document.addEventListener('click', function(e) {
        const optionsToggle = e.target.closest('.options-toggle');
        if (optionsToggle) {
            const menu = optionsToggle.closest('.message-options').querySelector('.options-menu');
            const isVisible = menu.classList.contains('visible');
            document.querySelectorAll('.options-menu.visible').forEach(m => {
                m.classList.remove('visible');
            });
            if (!isVisible) {
                menu.classList.add('visible');
            }
        }

        const deleteBtn = e.target.closest('.delete-btn');
        if (deleteBtn) {
            const messageElement = deleteBtn.closest('.chat-message');
            messageToDeleteId = messageElement.dataset.messageId;
            if (modal) modal.style.display = 'block';
            deleteBtn.closest('.options-menu').style.display = 'none';
        }

        const adminDeleteBtn = e.target.closest('.admin-delete-btn');
        if (adminDeleteBtn) {
            const messageElement = adminDeleteBtn.closest('.chat-message');
            const messageId = messageElement.dataset.messageId;
            showConfirmationModal(`Tem certeza que deseja apagar esta mensagem como administrador?`, () => {
                chatSocket.send(JSON.stringify({
                    'action': 'delete_message',
                    'message_id': messageId,
                    'scope': 'admin_delete'
                }));
            });
            adminDeleteBtn.closest('.options-menu').style.display = 'none';
        }

        const replyBtn = e.target.closest('.reply-btn');
        if (replyBtn) {
            const messageElement = replyBtn.closest('.chat-message');
            replyingToId = messageElement.dataset.messageId;
            const messageContent = messageElement.querySelector('.message-content').textContent;
            const messageAuthorUsername = messageElement.querySelector('.message-author')?.textContent || userName;

            if (messageAuthorUsername === userName) {
                replyBarUser.textContent = 'você mesmo';
            } else {
                replyBarUser.textContent = messageAuthorUsername;
            }
            replyBarMessage.textContent = messageContent;
            replyBar.style.display = 'flex';

            replyBtn.closest('.options-menu').style.display = 'none';
            messageInput.focus();
        }
    });

    if(cancelReplyBtn) {
        cancelReplyBtn.onclick = () => {
            replyingToId = null;
            replyBar.style.display = 'none';
        };
    }

    if (chatLog) {
        chatLog.addEventListener('dblclick', function(e) {
            const messageElement = e.target.closest('.chat-message');
            if (messageElement) {
                replyingToId = messageElement.dataset.messageId;
                const messageContent = messageElement.querySelector('.message-content').textContent;
                const messageAuthorUsername = messageElement.querySelector('.message-author')?.textContent || userName;

                if (messageAuthorUsername === userName) {
                    replyBarUser.textContent = 'você mesmo';
                } else {
                    replyBarUser.textContent = messageAuthorUsername;
                }
                replyBarMessage.textContent = messageContent;
                replyBar.style.display = 'flex';

                messageInput.focus();
            }
        });
    }

    if (modal) {
        cancelBtn.onclick = () => modal.style.display = 'none';
        window.onclick = (e) => { if (e.target == modal) modal.style.display = 'none'; };

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
    // --- FIM DA LÓGICA DE DELEÇÃO ---

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.user-actions-container') && !e.target.closest('.message-options')) {
            document.querySelectorAll('.actions-dropdown.visible, .options-menu.visible').forEach(d => d.classList.remove('visible'));
            document.querySelectorAll('.user-list-link.menu-open').forEach(link => link.classList.remove('menu-open'));
        }
        if (!e.target.closest('#room-actions-container')) {
            document.querySelectorAll('.room-actions-dropdown.visible').forEach(d => d.classList.remove('visible'));
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.actions-dropdown.visible, .options-menu.visible').forEach(d => d.classList.remove('visible'));
            document.querySelectorAll('.user-list-link.menu-open').forEach(link => link.classList.remove('menu-open'));
            if (replyBar.style.display !== 'none') {
                replyingToId = null;
                replyBar.style.display = 'none';
            }
        }
    });

    window.addEventListener('beforeunload', () => {
        if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
            chatSocket.send(JSON.stringify({ 'heartbeat': true }));
        }
    });

    const style = document.createElement('style');
    style.innerHTML = `
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
        #confirmation-modal .btn-secondary {
            background-color: #6c757d;
            border-color: #6c757d;
        }
        #confirmation-modal .btn-secondary:hover {
            background-color: #5a6268;
            border-color: #545b62;
        }

        .user-list-link {
            display: flex; align-items: center; justify-content: space-between;
            text-decoration: none; color: inherit; padding: 5px; border-radius: 5px;
            transition: background-color 0.2s;
        }
        .user-list-link:hover {
            background-color: var(--hover-color);
        }
        .user-list-link.menu-open, .user-list-link.menu-open:hover {
            background-color: var(--hover-color, #e9ecef);
        }
        .user-list-link .user-info { display: flex; align-items: center; gap: 8px; }
        .user-list-link .chat-avatar { width: 25px; height: 25px; border-radius: 50%; }
        .user-list-link .user-status { display: block; font-size: 0.75rem; color: #888; }
        .admin-badge { font-size: 0.8em; margin-left: 4px; cursor: help; }

        .user-actions-container { position: relative; }
        .more-options-btn {
            background: none; border: none; font-size: 1.2rem; line-height: 1;
            cursor: pointer; padding: 0 8px; border-radius: 4px; color: var(--text-color);
        }
        .more-options-btn:hover { background-color: var(--hover-color); }
        
        .actions-dropdown, .room-actions-dropdown {
            display: none; position: absolute; right: 0; top: 100%;
            background-color: var(--bg-card, #fff);
            border: 1px solid var(--border-color, #ccc);
            border-radius: 5px; box-shadow: 0 2px 10px rgba(0,0,0,0.15);
            z-index: 1001;
            min-width: 120px;
        }
        .actions-dropdown.visible, .room-actions-dropdown.visible { display: block; }
        .actions-dropdown a, .room-actions-dropdown a {
            display: block; padding: 8px 12px; color: var(--text-main);
            text-decoration: none; font-size: 0.9rem;
        }
        .actions-dropdown a:hover, .room-actions-dropdown a:hover { background-color: var(--primary-accent); color: white; }
        .message-action-btn:hover { background-color: var(--primary-accent); color: white; }

        #room-actions-container { position: relative; }
        .room-settings-btn {
            background: none; border: none; font-size: 1.5rem; cursor: pointer;
            color: var(--text-main);
        }
    `;
    document.head.appendChild(style);
});