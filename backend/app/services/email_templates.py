"""Localized transactional emails (ru, kk, en). The language is the user's saved interface language, falling back
to the language of the current request, then Russian."""

from __future__ import annotations

from app.core.context import language_var

TEMPLATES: dict[str, dict[str, tuple[str, str]]] = {
    "verify_email": {
        "ru": ("Подтвердите почту для Isker",
               "Здравствуйте, {name}!\n\nПодтвердите адрес электронной почты, чтобы защитить аккаунт Isker:\n{link}\n\n"
               "Ссылка действует {hours} ч. Если вы не создавали аккаунт, просто проигнорируйте это письмо."),
        "kk": ("Isker үшін поштаңызды растаңыз",
               "Сәлеметсіз бе, {name}!\n\nIsker аккаунтыңызды қорғау үшін электрондық пошта мекенжайыңызды растаңыз:\n"
               "{link}\n\nСілтеме {hours} сағат жарамды. Аккаунт құрмаған болсаңыз, бұл хатты елемеңіз."),
        "en": ("Confirm your email for Isker",
               "Hi {name},\n\nConfirm your email address to secure your Isker account:\n{link}\n\n"
               "The link expires in {hours} hours. If you didn't create an account, ignore this message."),
    },
    "reset_password": {
        "ru": ("Сброс пароля Isker",
               "Здравствуйте, {name}!\n\nПерейдите по ссылке, чтобы задать новый пароль:\n{link}\n\n"
               "Ссылка действует {minutes} мин и срабатывает один раз. Если вы не запрашивали сброс, проигнорируйте "
               "это письмо — пароль останется прежним."),
        "kk": ("Isker құпиясөзін қалпына келтіру",
               "Сәлеметсіз бе, {name}!\n\nЖаңа құпиясөз орнату үшін сілтемеге өтіңіз:\n{link}\n\n"
               "Сілтеме {minutes} минут жарамды және бір рет қана жұмыс істейді. "
               "Егер сіз сұрамаған болсаңыз, бұл хатты елемеңіз — құпиясөзіңіз өзгермейді."),
        "en": ("Reset your Isker password",
               "Hi {name},\n\nUse this link to choose a new password:\n{link}\n\n"
               "The link expires in {minutes} minutes and works once. If you didn't ask for this, you can ignore this "
               "message — your password stays the same."),
    },
}


def email_language(user) -> str:
    saved = getattr(getattr(user, "profile", None), "language", None)
    return saved if saved in ("ru", "kk", "en") else language_var.get()


def render(template: str, language: str, **values: object) -> tuple[str, str]:
    subject, body = TEMPLATES[template].get(language) or TEMPLATES[template]["ru"]
    return subject, body.format(**values)
