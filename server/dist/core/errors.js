export class AppError extends Error {
    code;
    statusCode;
    details;
    constructor(message, code = 'INTERNAL_ERROR', statusCode = 500, details) {
        super(message);
        this.name = new.target.name;
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
    toPayload() {
        return { code: this.code, message: this.message, statusCode: this.statusCode, details: this.details };
    }
}
export class ValidationError extends AppError {
    constructor(message = 'داده ارسالی نامعتبر است.', details) {
        super(message, 'VALIDATION_ERROR', 422, details);
    }
}
export class NotFoundError extends AppError {
    constructor(message = 'منبع درخواستی یافت نشد.') {
        super(message, 'NOT_FOUND', 404);
    }
}
export class ConfigurationError extends AppError {
    constructor(message = 'پیکربندی سامانه ناقص است.', details) {
        super(message, 'CONFIGURATION_ERROR', 500, details);
    }
}
export class IntegrationError extends AppError {
    constructor(message = 'خطا در سرویس بیرونی.', details) {
        super(message, 'INTEGRATION_ERROR', 502, details);
    }
}
export class ForbiddenError extends AppError {
    constructor(message = 'دسترسی به این عملیات مجاز نیست.') {
        super(message, 'FORBIDDEN', 403);
    }
}
export class ConflictError extends AppError {
    constructor(message = 'عملیات با وضعیت موجود داده‌ها در تضاد است.', details) {
        super(message, 'CONFLICT', 409, details);
    }
}
export class UnauthorizedError extends AppError {
    constructor(message = 'برای این عملیات باید وارد حساب شوید.') {
        super(message, 'UNAUTHORIZED', 401);
    }
}
