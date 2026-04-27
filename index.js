(function (metro, toasts, alerts, assets, plugin) {
    'use strict';

    // src/index.tsx
    const defaultSettings = {
        targetLang: "vi",
        autoTranslate: false
    };
    if (!plugin.storage.settings)
        plugin.storage.settings = { ...defaultSettings };
    else
        plugin.storage.settings = { ...defaultSettings, ...plugin.storage.settings };
    // --- API Google Translate (giống Vencord) ---
    async function googleTranslate(text, source, target) {
        const url = "https://translate-pa.googleapis.com/v1/translate?" + new URLSearchParams({
            "params.client": "gtx",
            "dataTypes": "TRANSLATION",
            "key": "AIzaSyDLEeFI5OtFBwYBIoK_jj5m32rZK5CkCXA",
            "query.sourceLanguage": source,
            "query.targetLanguage": target,
            "query.text": text,
        });
        const res = await fetch(url);
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return { sourceLang: data.sourceLanguage, translated: data.translation };
    }
    async function translateText(text, target) {
        if (!text || text.length < 2)
            return null;
        try {
            const res = await googleTranslate(text, "auto", target);
            return res.translated;
        }
        catch (e) {
            console.error("[Translator] Lỗi:", e);
            return null;
        }
    }
    // --- Giữ nguyên mention, emoji, link ---
    const PRESERVED = /(<@!?\d+>|<#\d+>|:\w+:|\p{Emoji}|https?:\/\/\S+)/gu;
    async function translatePreserving(original, target) {
        let parts = [];
        let last = 0;
        let match;
        while ((match = PRESERVED.exec(original)) !== null) {
            if (match.index > last)
                parts.push({ type: "text", content: original.slice(last, match.index) });
            parts.push({ type: "keep", content: match[0] });
            last = PRESERVED.lastIndex;
        }
        if (last < original.length)
            parts.push({ type: "text", content: original.slice(last) });
        const toTranslate = parts.filter(p => p.type === "text").map(p => p.content).join("|||");
        if (!toTranslate.trim())
            return original;
        const translatedFull = await translateText(toTranslate, target);
        if (!translatedFull)
            return null;
        const translatedParts = translatedFull.split(/\|\|\|/);
        let result = "", idx = 0;
        for (const part of parts) {
            if (part.type === "text")
                result += translatedParts[idx++] || part.content;
            else
                result += part.content;
        }
        return result;
    }
    // --- Lấy nội dung tin nhắn ---
    const getMessageContent = (msg) => {
        if (msg.content)
            return msg.content;
        if (msg.messageSnapshots?.[0]?.message?.content)
            return msg.messageSnapshots[0].message.content;
        const embed = msg.embeds?.[0];
        if (embed?.type === "auto_moderation_message" && embed.rawDescription)
            return embed.rawDescription;
        return "";
    };
    // --- Thêm mục "Dịch" vào menu chuột phải tin nhắn ---
    let unpatchMessageMenu = null;
    function patchMessageMenu() {
        const MenuModule = metro.getByProps("MenuItem", "Menu");
        if (!MenuModule)
            return;
        const unpatch = MenuModule.patch?.("message", (ctx) => {
            if (!ctx.message)
                return;
            const translateItem = {
                label: "Dịch",
                icon: assets.getAssetId("ic_message_translate"),
                onPress: async () => {
                    const content = getMessageContent(ctx.message);
                    if (!content) {
                        toasts.showToast("Không có nội dung", 2);
                        return;
                    }
                    const translated = await translatePreserving(content, plugin.storage.settings.targetLang);
                    if (translated) {
                        alerts.showAlert({
                            title: "Bản dịch",
                            content: translated,
                            confirmText: "OK"
                        });
                    }
                    else {
                        toasts.showToast("Dịch thất bại", 3);
                    }
                }
            };
            ctx.children = ctx.children ? [...ctx.children, translateItem] : [translateItem];
        });
        unpatchMessageMenu = unpatch;
    }
    // --- Nút bật/tắt Auto Translate trên thanh chat ---
    let chatBarButtonUnpatch = null;
    function addChatBarButton() {
        const ChatInput = metro.getByProps("ChatInput", "default")?.ChatInput;
        if (!ChatInput)
            return;
        const id = "super-translator-btn";
        const button = {
            id,
            icon: assets.getAssetId("ic_message_translate"),
            onPress: () => {
                plugin.storage.settings.autoTranslate = !plugin.storage.settings.autoTranslate;
                toasts.showToast(`Auto Translate: ${plugin.storage.settings.autoTranslate ? "BẬT" : "TẮT"}`, plugin.storage.settings.autoTranslate ? 1 : 2);
            },
            color: () => plugin.storage.settings.autoTranslate ? "#ff4d4d" : undefined
        };
        const unpatch = ChatInput.addAccessory?.(button);
        if (unpatch)
            chatBarButtonUnpatch = unpatch;
    }
    // --- Hook tự động dịch tin nhắn trước khi gửi ---
    function autoTranslateOnSend() {
        const MessageStore = metro.getByStoreName("MessageStore");
        if (!MessageStore)
            return;
        const originalSendMessage = MessageStore.sendMessage;
        if (!originalSendMessage)
            return;
        MessageStore.sendMessage = async function (channelId, message, ...args) {
            if (plugin.storage.settings.autoTranslate && message.content && !message.content.startsWith("++")) {
                const translated = await translatePreserving(message.content, plugin.storage.settings.targetLang);
                if (translated)
                    message.content = translated;
            }
            return originalSendMessage.call(this, channelId, message, ...args);
        };
        return () => { MessageStore.sendMessage = originalSendMessage; };
    }
    let unpatchSend = null;
    // --- Plugin xuất ---
    var index = {
        manifest: {
            id: "vn.nguyenthanh.translator",
            name: "Super Translator",
            version: "1.0.0",
            description: "Dịch tin nhắn giữ nguyên định dạng",
            authors: [{ name: "Your Name" }]
        },
        start() {
            console.log("[Super Translator] Started");
            patchMessageMenu();
            addChatBarButton();
            unpatchSend = autoTranslateOnSend();
        },
        stop() {
            console.log("[Super Translator] Stopped");
            unpatchMessageMenu?.();
            chatBarButtonUnpatch?.();
            unpatchSend?.();
        }
    };

    return index;

})(Kettu.metro, toasts, alerts, assets, plugin);
