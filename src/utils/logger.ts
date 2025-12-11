export class Logger {
    private scope: string;

    constructor(scope: string) {
        this.scope = scope;
    }

    info(message: string) {
        console.log(`[${new Date().toLocaleTimeString()}] [INFO] [${this.scope}] ${message}`);
    }

    error(message: string) {
        console.error(`[${new Date().toLocaleTimeString()}] [ERROR] [${this.scope}] ${message}`);
    }

    warn(message: string) {
        console.warn(`[${new Date().toLocaleTimeString()}] [WARN] [${this.scope}] ${message}`);
    }

    success(message: string) {
        console.log(`[${new Date().toLocaleTimeString()}] [SUCCESS] [${this.scope}] ${message}`);
    }
}
