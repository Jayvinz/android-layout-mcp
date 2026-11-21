export class DliError extends Error {
    code;
    hint;
    constructor(code, message, hint) {
        super(message);
        this.name = "DliError";
        this.code = code;
        this.hint = hint;
    }
}
export function errorMessage(error) {
    if (error instanceof Error) {
        if (error instanceof DliError && error.hint) {
            return `${error.message}\nHint: ${error.hint}`;
        }
        return error.message;
    }
    return String(error);
}
export function toDliError(error) {
    if (error instanceof DliError)
        return error;
    return new DliError("VIEW_DUMP_FAILED", errorMessage(error));
}
