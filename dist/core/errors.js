export class AlmError extends Error {
    code;
    hint;
    constructor(code, message, hint) {
        super(message);
        this.name = "AlmError";
        this.code = code;
        this.hint = hint;
    }
}
export function errorMessage(error) {
    if (error instanceof Error) {
        if (error instanceof AlmError && error.hint) {
            return `${error.message}\nHint: ${error.hint}`;
        }
        return error.message;
    }
    return String(error);
}
