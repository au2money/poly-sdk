import WebSocket, { MessageEvent, CloseEvent, ErrorEvent } from "isomorphic-ws";
import { SubscriptionMessage, Message, ConnectionStatus } from "./model";

const DEFAULT_HOST = "wss://ws-live-data.polymarket.com";
const DEFAULT_PING_INTERVAL = 5000;
const RECONNECT_DELAY = 3000; // 增加重连延迟，防止雪崩

export interface RealTimeDataClientArgs {
    onConnect?: (client: RealTimeDataClient) => void;
    onMessage?: (client: RealTimeDataClient, message: Message) => void;
    onStatusChange?: (status: ConnectionStatus) => void;
    host?: string;
    pingInterval?: number;
    autoReconnect?: boolean;
}

export class RealTimeDataClient {
    private readonly host: string;
    private readonly pingInterval: number;
    private autoReconnect: boolean;
    private readonly onConnect?: (client: RealTimeDataClient) => void;
    private readonly onCustomMessage?: (client: RealTimeDataClient, message: Message) => void;
    private readonly onStatusChange?: (status: ConnectionStatus) => void;
    
    private ws: WebSocket | null = null;
    private pingTimer?: ReturnType<typeof setInterval>;
    private pongTimeout?: ReturnType<typeof setTimeout>;
    private reconnectTimer?: ReturnType<typeof setTimeout>;

    constructor(args: RealTimeDataClientArgs = {}) {
        this.host = args.host || DEFAULT_HOST;
        this.pingInterval = args.pingInterval || DEFAULT_PING_INTERVAL;
        this.autoReconnect = args.autoReconnect !== undefined ? args.autoReconnect : true;
        this.onCustomMessage = args.onMessage;
        this.onConnect = args.onConnect;
        this.onStatusChange = args.onStatusChange;
    }

    public connect() {
        // 1. 清理之前的连接和定时器，防止多个实例并存
        this.clearTimers();
        this.cleanupWS();

        this.notifyStatusChange(ConnectionStatus.CONNECTING);
        
        try {
            this.ws = new WebSocket(this.host);

            // 2. 使用箭头函数包装，确保 this 始终指向类实例
            this.ws.onopen = () => this.handleOpen();
            this.ws.onmessage = (event: MessageEvent) => this.handleMessage(event);
            this.ws.onclose = (event: CloseEvent) => this.handleClose(event);
            this.ws.onerror = (event: ErrorEvent) => this.handleError(event);
            console.log('tmzhix')
        } catch (err) {
            console.error("Connection attempt failed:", err);
            this.scheduleReconnect();
        }
        return this;
    }

    private handleOpen() {
        console.log("Connected to Polymarket WS");
        this.notifyStatusChange(ConnectionStatus.CONNECTED);
        
        // 3. 启动定时心跳，不依赖不稳定的 onPong
        this.startPinging();

        console.log(1, this.onConnect)
        if (this.onConnect) {
            this.onConnect(this);
        }
    }

    private handleMessage(event: MessageEvent) {
        try {
            if (typeof event.data === "string" && event.data.length > 0) {
                // 处理 Polymarket 的心跳响应或业务数据
                if (event.data === "pong") {
                    this.clearPongTimeout();
                    return;
                }

                const message = JSON.parse(event.data);
                if (this.onCustomMessage) {
                    this.onCustomMessage(this, message as Message);
                }
            }
        } catch (e) {
            console.error("Failed to parse message:", e, event.data);
        }
    }

    private handleError(err: ErrorEvent) {
        console.error("WebSocket Error:", err.message);
        // 注意：onerror 之后通常会触发 onclose，所以重连逻辑放在 onclose 更稳健
    }

    private handleClose(event: CloseEvent) {
        console.log('close')
        this.notifyStatusChange(ConnectionStatus.DISCONNECTED);
        this.stopPinging();
        
        if (this.autoReconnect) {
            console.warn(`Connection closed (code: ${event.code}). Reconnecting in ${RECONNECT_DELAY}ms...`);
            this.scheduleReconnect();
        }
    }

    private startPinging() {
        this.stopPinging();
        this.pingTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send("ping");
                this.pongTimeout = setTimeout(() => {
                    console.warn("WebSocket Pong timeout. Terminating connection...");
                    (this.ws as any)?.terminate?.() || this.ws?.close();
                }, 10000);
            }
        }, this.pingInterval);
    }

    private stopPinging() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = undefined;
        }
        this.clearPongTimeout();
    }

    private clearPongTimeout() {
        if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = undefined;
        }
    }

    private scheduleReconnect() {
        if (this.reconnectTimer) return; // 避免重复触发重连
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            this.connect();
        }, RECONNECT_DELAY);
    }

    private clearTimers() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }

    private cleanupWS() {
        if (this.ws) {
            // 移除所有监听器，防止旧连接的回调继续执行
            this.ws.onopen = null;
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.onmessage = null;
            if (this.ws.readyState !== WebSocket.CLOSED) {
                this.ws.close();
            }
            this.ws = null;
        }
    }

    public subscribe(msg: SubscriptionMessage) {
        this.sendSafe({ action: "subscribe", ...msg });
    }

    public unsubscribe(msg: SubscriptionMessage) {
        this.sendSafe({ action: "unsubscribe", ...msg });
    }

    private sendSafe(payload: object) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(payload));
        } else {
            console.error("Cannot send message: WebSocket not open.");
        }
    }

    public disconnect() {
        this.autoReconnect = false;
        this.clearTimers();
        this.stopPinging();
        this.cleanupWS();
        this.notifyStatusChange(ConnectionStatus.DISCONNECTED);
    }

    private notifyStatusChange(status: ConnectionStatus) {
        this.onStatusChange?.(status);
    }
}