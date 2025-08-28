document.addEventListener('DOMContentLoaded', () => {
    // Variáveis de estado
    let isWindowActive = true;
    let unreadMessages = 0;
    const originalTitle = document.title;
    window.onfocus = () => { isWindowActive = true; unreadMessages = 0; document.title = originalTitle; };
    window.onblur = () => { isWindowActive = false; };

    // Elementos do DOM
    const roomSlugElement = document.getElementById('room-slug');
    const userNameElement = document.getElementById('user-username');
    if (!roomSlugElement || !userNameElement) return;

    const roomSlug = JSON.parse(roomSlugElement.textContent);
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

    const settingsBtn = document.getElementById('settings-btn');
    const chatSettingsModal = document.getElementById('chatSettingsModal');
    const cancelSettingsBtn = document.getElementById('cancel-settings-btn');
    const chatSettingsForm = document.getElementById('chat-settings-form');
    const userManagementList = document.getElementById('user-management-list');
    const muteRoomBtn = document.getElementById('mute-room-btn');

    let currentUserList = [];

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

    // Estado do WebSocket e do Chat
    let typingTimer;
    const TYPING_TIMER_LENGTH = 2000;
    let isTyping = false;
    let typingUsers = new Set();
    let isRoomMuted = false;
    let currentUserIsAdmin = false;
    let currentUserIsMuted = false;
    let chatSocket;

    // --- Conexão WebSocket ---
    try {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        chatSocket = new WebSocket(`${protocol}://${window.location.host}/ws/chat/${roomSlug}/`);
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
        if (e.code === 4002) {
            message = 'Acesso negado. Redirecionando para a página de senha...';
            window.location.href = `/chat/${roomSlug}/`;
        }
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
            if (user.username === userName) return; // Don't show current user in management list

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

    if (userManagementList) {
        userManagementList.addEventListener('click', (e) => {
            const actionBtn = e.target.closest('.admin-action-btn');
            if (actionBtn) {
                e.preventDefault();
                const { action, target } = actionBtn.dataset;
                const actionText = actionBtn.textContent;
                showConfirmationModal(`Tem certeza que deseja "${actionText}" o usuário "${target}"?`, () => {
                    chatSocket.send(JSON.stringify({ 'type': 'admin_action', 'action': action, 'target': target }));
                });
            }
        });
    }

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

        function truncateString(str, num) {
        if (str.length > num) {
            return str.slice(0, num) + "...";
        }
        return str;
    }

        let replyContextHtml = '';
        if (data.parent) {
            const parentAuthor = data.parent.author === userName ? 'você mesmo' : data.parent.author;
            const truncatedContent = data.parent.content;
            replyContextHtml = `
                <div class="reply-context">
                    Respondendo a <strong>${parentAuthor}</strong>: 
                    <div class="reply-content">${truncatedContent}</div>
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

                // Fecha todos os outros menus antes de avaliar este
                document.querySelectorAll('.actions-dropdown.visible').forEach(d => d.classList.remove('visible'));
                document.querySelectorAll('.user-list-link.menu-open').forEach(link => link.classList.remove('menu-open'));

                if (!isVisible) {
                    dropdown.classList.add('visible');
                    userLink.classList.add('menu-open');
                }
                return; 
            }

            if (actionBtn) {
                e.preventDefault();
                const { action, target } = actionBtn.dataset;
                const actionText = actionBtn.textContent;
                showConfirmationModal(`Tem certeza que deseja "${actionText}" o usuário "${target}"?`, () => {
                    chatSocket.send(JSON.stringify({ 'type': 'admin_action', 'action': action, 'target': target }));
                });
                return;
            }

            if (messageBtn) {
                // A navegação é tratada pelo href do link
                return;
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
            if (chatSettingsModal.style.display === 'block') {
                chatSettingsModal.style.display = 'none';
                document.body.classList.remove('modal-open');
            }
        }
    });

    window.addEventListener('beforeunload', () => {
        if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
            chatSocket.send(JSON.stringify({ 'heartbeat': true }));
        }
    });

    document.head.appendChild(style);

    const clearChatBtn = document.getElementById('clear-chat-btn');
    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', () => {
            const url = clearChatBtn.dataset.url;
            showConfirmationModal('Tem certeza que deseja limpar todo o histórico desta conversa? Esta ação não pode ser desfeita.', () => {
                window.location.href = url;
            });
        });
    }
});