import WebSocket, { MessageEvent, CloseEvent, ErrorEvent } from "isomorphic-ws";
import { SubscriptionMessage, Message, ConnectionStatus } from "./model";


const DEFAULT_HOST = "wss://ws-live-data.polymarket.com";
const RECONNECT_DELAY = 3000;

export interface RealTimeDataClientArgs {
    onConnect?: (client: RealTimeDataClient) => void;
    onMessage?: (client: RealTimeDataClient, message: Message) => void;
    onStatusChange?: (status: ConnectionStatus) => void;
    host?: string;
    autoReconnect?: boolean;
}

export class RealTimeDataClient {
    private readonly host: string;
    private autoReconnect: boolean;

    private readonly onConnect?: (client: RealTimeDataClient) => void;
    private readonly onCustomMessage?: (client: RealTimeDataClient, message: Message) => void;
    private readonly onStatusChange?: (status: ConnectionStatus) => void;

    private ws?: WebSocket;

    /** 🔒 防止并发重连 */
    private reconnecting = false;
    private manuallyClosed = false;

    constructor(args?: RealTimeDataClientArgs) {
        this.host = args?.host ?? DEFAULT_HOST;
        this.autoReconnect = args?.autoReconnect ?? true;
        this.onCustomMessage = args?.onMessage;
        this.onConnect = args?.onConnect;
        this.onStatusChange = args?.onStatusChange;
    }

    public connect() {
        this.manuallyClosed = false;

        // 防止重复创建
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return this;
        }

        this.notifyStatusChange(ConnectionStatus.CONNECTING);

        this.ws = new WebSocket(this.host);

        this.ws.onopen = this.onOpen;
        this.ws.onmessage = this.onMessage;
        this.ws.onclose = this.onClose;
        this.ws.onerror = this.onError;

        return this;
    }

    private onOpen = () => {
        this.reconnecting = false;
        this.notifyStatusChange(ConnectionStatus.CONNECTED);
        this.onConnect?.(this);
    };

    private onMessage = (event: MessageEvent) => {
        if (typeof event.data !== "string" || !event.data) return;

        if (this.onCustomMessage && event.data.includes("payload")) {
            try {
                const msg = JSON.parse(event.data);
                this.onCustomMessage(this, msg as Message);
            } catch (e) {
                console.error("message parse error", e);
            }
        }
    };

    private onError = (err: ErrorEvent) => {
        // ❗ error 里不要直接 reconnect
        this.reconnecting = false; 
        console.error("ws error", err.message);
    };

    private onClose = (event: CloseEvent) => {
        console.warn(
            "ws closed",
            "code:", event.code,
            "reason:", event.reason
        );

        this.notifyStatusChange(ConnectionStatus.DISCONNECTED);
        this.reconnecting = false; 

        if (!this.autoReconnect || this.manuallyClosed) return;

        this.scheduleReconnect();
    };

    private scheduleReconnect() {
        if (this.reconnecting) return;

        this.reconnecting = true;

        setTimeout(() => {
            if (this.manuallyClosed) return;
            this.connect();
        }, RECONNECT_DELAY);
    }

    public disconnect() {
        this.autoReconnect = false;
        this.manuallyClosed = true;

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
        }
    }

    public subscribe(msg: SubscriptionMessage) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return console.warn("subscribe failed: socket not open");
        }

        this.ws.send(
            JSON.stringify({ action: "subscribe", ...msg }),
            err => {
                if (err) {
                    console.error("subscribe error", err);
                    this.ws?.close();
                }
            }
        );
    }

    public unsubscribe(msg: SubscriptionMessage) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return console.warn("unsubscribe failed: socket not open");
        }

        this.ws.send(
            JSON.stringify({ action: "unsubscribe", ...msg }),
            err => {
                if (err) {
                    console.error("unsubscribe error", err);
                    this.ws?.close();
                }
            }
        );
    }

    private notifyStatusChange(status: ConnectionStatus) {
        this.onStatusChange?.(status);
    }
}
