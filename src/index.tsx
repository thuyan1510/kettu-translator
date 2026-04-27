// src/index.tsx
import { getByProps, getByStoreName } from "@revenge/metro";
import { FluxDispatcher } from "@revenge/metro/common";
import { showToast } from "@revenge/ui/toasts";
import { showAlert } from "@revenge/ui/alerts";
import { getAssetId } from "@revenge/ui/assets";
import { storage } from "@revenge/plugin";

// --- Cài đặt mặc định ---
interface Settings {
    targetLang: string;
    autoTranslate: boolean;
}

const defaultSettings: Settings = {
    targetLang: "vi",
    autoTranslate: false
};

if (!storage.settings) storage.settings = { ...defaultSettings };
else storage.settings = { ...defaultSettings, ...storage.settings };

// --- API Google Translate (giống Vencord) ---
async function googleTranslate(text: string, source: string, target: string) {
    const url = "https://translate-pa.googleapis.com/v1/translate?" + new URLSearchParams({
        "params.client": "gtx",
        "dataTypes": "TRANSLATION",
        "key": "AIzaSyDLEeFI5OtFBwYBIoK_jj5m32rZK5CkCXA",
        "query.sourceLanguage": source,
        "query.targetLanguage": target,
        "query.text": text,
    });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { sourceLang: data.sourceLanguage, translated: data.translation };
}

async function translateText(text: string, target: string): Promise<string | null> {
    if (!text || text.length < 2) return null;
    try {
        const res = await googleTranslate(text, "auto", target);
        if (typeof res.translated === 'string') return res.translated;
        return null;
    } catch (e) {
        console.error("[Super Translator] Lỗi dịch:", e);
        return null;
    }
}

// --- Giữ nguyên mention, emoji, link (CẬP NHẬT REGEX) ---
// Giữ nguyên các cú pháp đặc biệt: mention người/vai trò/kênh, emoji, link, code, in đậm, in nghiêng, gạch ngang, spoiler
const PRESERVED = /(<@!?\d+>|<#\d+>|:\w+:|\p{Emoji}|https?:\/\/\S+|`[^`]+`|```[\s\S]+?```|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\|\|[^\|]+\|\|)/gu;

async function translatePreserving(original: string, target: string): Promise<string | null> {
    let parts: { type: "text" | "keep"; content: string }[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = PRESERVED.exec(original)) !== null) {
        if (match.index > last) parts.push({ type: "text", content: original.slice(last, match.index) });
        parts.push({ type: "keep", content: match[0] });
        last = PRESERVED.lastIndex;
    }
    if (last < original.length) parts.push({ type: "text", content: original.slice(last) });

    const toTranslate = parts.filter(p => p.type === "text").map(p => p.content).join("|||");
    if (!toTranslate.trim()) return original;

    const translatedFull = await translateText(toTranslate, target);
    if (!translatedFull) return null;

    const translatedParts = translatedFull.split(/\|\|\|/);
    let result = "", idx = 0;
    for (const part of parts) {
        if (part.type === "text") result += translatedParts[idx++] || part.content;
        else result += part.content;
    }
    return result;
}

// --- Lấy nội dung tin nhắn (CẬP NHẬT: hỗ trợ reply) ---
const getMessageContent = (msg: any): string => {
    if (msg.content) return msg.content;
    if (msg.messageSnapshots?.[0]?.message?.content) return msg.messageSnapshots[0].message.content;
    const embed = msg.embeds?.[0];
    if (embed?.type === "auto_moderation_message" && embed.rawDescription) return embed.rawDescription;
    return "";
};

// --- Thêm mục "Dịch" vào menu chuột phải tin nhắn ---
const patches: any[] = [];

function patchMessageMenu() {
    const unpatch = patchAll("message", (ctx: any) => {
        if (!ctx.message) return;
        const translateItem = {
            label: "Dịch",
            icon: getAssetId("ic_message_translate"),
            onPress: async () => {
                const content = getMessageContent(ctx.message);
                if (!content) {
                    showToast("Không có nội dung", 2);
                    return;
                }
                const translated = await translatePreserving(content, storage.settings.targetLang);
                if (translated) {
                    showAlert({
                        title: "Bản dịch",
                        content: translated,
                        confirmText: "OK"
                    });
                } else {
                    showToast("Dịch thất bại", 3);
                }
            }
        };
        ctx.children = ctx.children ? [...ctx.children, translateItem] : [translateItem];
    });
    patches.push(unpatch);
}

function patchAll(...args: any[]) {
    const unpatchFunc = getByProps(...args);
    return unpatchFunc;
}

// --- Nút bật/tắt Auto Translate trên thanh chat (CẬP NHẬT) ---
function addChatBarButton() {
    const ChatInput = getByProps("ChatInput")?.ChatInput;
    if (!ChatInput) return;
    const id = "super-translator-btn";
    const button = {
        id,
        icon: getAssetId("ic_message_translate"),
        onPress: () => {
            storage.settings.autoTranslate = !storage.settings.autoTranslate;
            showToast(`Auto Translate: ${storage.settings.autoTranslate ? "BẬT" : "TẮT"}`, storage.settings.autoTranslate ? 1 : 2);
        },
        color: () => storage.settings.autoTranslate ? "#ff4d4d" : undefined
    };
    const unpatch = ChatInput.addAccessory?.(button);
    if (unpatch) patches.push(unpatch);
}

// --- Hook tự động dịch tin nhắn trước khi gửi (CẬP NHẬT) ---
function autoTranslateOnSend() {
    const MessageStore = getByStoreName("MessageStore");
    if (!MessageStore) return;
    const originalSendMessage = MessageStore.sendMessage;
    if (!originalSendMessage) return;
    MessageStore.sendMessage = async function(channelId: string, message: any, ...args: any[]) {
        if (storage.settings.autoTranslate && message.content && !message.content.startsWith("++")) {
            const translated = await translatePreserving(message.content, storage.settings.targetLang);
            if (translated) message.content = translated;
        }
        return originalSendMessage.call(this, channelId, message, ...args);
    };
    return () => { MessageStore.sendMessage = originalSendMessage; };
}

// --- Plugin xuất (CẬP NHẬT THEO ĐÚNG CHUẨN CỦA REVENGE) ---
export default {
    manifest: {
        name: "Super Translator",
        version: "1.0.0",
        description: "Dịch tin nhắn giữ nguyên định dạng",
        authors: ["Your Name"],
    },
    start() {
        console.log("[Super Translator] Started");
        patchMessageMenu();
        addChatBarButton();
        const unpatchSend = autoTranslateOnSend();
        if (unpatchSend) patches.push(unpatchSend);
    },
    stop() {
        console.log("[Super Translator] Stopped");
        while (patches.length) {
            const unpatch = patches.pop();
            if (unpatch) unpatch();
        }
    }
};
