import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { onboardingSchema, registerSchema } from "../features/schemas";
import { LoginPage } from "../pages/Login";
import { RegisterPage } from "../pages/Register";
import { mockApi, renderWithProviders } from "./utils";

const user = { id: 1, email: "a@b.co", full_name: "Dana", status: "active", roles: ["user"], permissions: [], email_verified: true, onboarding_completed: true, created_at: "2026-01-01" };

describe("validation schemas", () => {
  it("requires a letter and a number in passwords and matching confirmation", () => {
    const base = { full_name: "Dana", email: "a@b.co", accept_terms: true };
    expect(registerSchema.safeParse({ ...base, accept_terms: false, password: "abcd1234", confirm: "abcd1234" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "abcdefgh", confirm: "abcdefgh" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "abcd1234", confirm: "abcd1235" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "abcd1234", confirm: "abcd1234" }).success).toBe(true);
  });
  it("requires at least one goal in onboarding", () => {
    const r = onboardingSchema.safeParse({ full_name: "Dana", education: "Master", entrepreneurial_experience: "none", goal_codes: [], preferred_learning_format: "video", weekly_learning_minutes: 60 });
    expect(r.success).toBe(false);
  });
});

describe("login form", () => {
  it("shows field errors and does not call the API when empty", async () => {
    const calls = mockApi({});
    renderWithProviders(<LoginPage />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter your email")).toBeInTheDocument();
    expect(screen.getByText("Enter your password")).toBeInTheDocument();
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });

  it("shows the server message on wrong credentials", async () => {
    mockApi({ "POST /api/auth/login": { status: 401, json: { error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } } } });
    renderWithProviders(<LoginPage />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
  });

  it("signs in and navigates to the dashboard", async () => {
    const calls = mockApi({ "POST /api/auth/login": { json: { user, access_token: "t", token_type: "bearer", expires_at: "x" } } });
    renderWithProviders(<LoginPage />, { route: "/login", path: "/login" });
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "Secret123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getAllByTestId("location")[0]).toHaveTextContent("/dashboard"));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ email: "a@b.co", password: "Secret123", remember_me: false });
  });
});

describe("register form", () => {
  it("maps a taken email to the email field", async () => {
    mockApi({ "POST /api/auth/register": { status: 409, json: { error: { code: "EMAIL_TAKEN", message: "An account with this email already exists." } } } });
    renderWithProviders(<RegisterPage />);
    await userEvent.type(screen.getByLabelText("Full name"), "Dana Learner");
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "Secret123");
    await userEvent.type(screen.getByLabelText("Confirm password"), "Secret123");
    await userEvent.click(screen.getByLabelText(/I agree to the/));
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("An account with this email already exists. Sign in or reset your password.")).toBeInTheDocument();
  });

  it("requires accepting the terms before calling the API and sends accept_terms", async () => {
    const calls = mockApi({ "POST /api/auth/register": { status: 201, json: { user: { ...user, onboarding_completed: false }, access_token: "x", token_type: "bearer", expires_at: "2027-01-01", email_verification: "logged" } } });
    renderWithProviders(<RegisterPage />);
    await userEvent.type(screen.getByLabelText("Full name"), "Dana Learner");
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "Secret123");
    await userEvent.type(screen.getByLabelText("Confirm password"), "Secret123");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText(/You need to accept the Terms of Use/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
    await userEvent.click(screen.getByLabelText(/I agree to the/));
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByTestId("location")).toBeInTheDocument();
    const posts = () => calls.filter((c) => c.method === "POST");
    await waitFor(() => expect(posts()).toHaveLength(1));
    // The interface language is sent so emails and the saved preference match what the user sees.
    expect(posts()[0].body).toEqual({ full_name: "Dana Learner", email: "a@b.co", password: "Secret123", accept_terms: true, language: "en" });
  });
});

describe("login page: password visibility, remember me, Google", () => {
  it("toggles password visibility without changing the value and without submitting", async () => {
    const calls = mockApi({});
    renderWithProviders(<LoginPage />);
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    await userEvent.type(input, "Secret123");
    expect(input.type).toBe("password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);
    expect(input.type).toBe("text");
    expect(input.value).toBe("Secret123");
    const hide = screen.getByRole("button", { name: "Hide password" });
    expect(hide).toHaveAttribute("aria-pressed", "true");
    // Keyboard: focus the control and press Enter/Space.
    hide.focus();
    await userEvent.keyboard("{Enter}");
    expect(input.type).toBe("password");
    expect(input.value).toBe("Secret123");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("sends remember_me when the checkbox is ticked", async () => {
    const calls = mockApi({ "POST /api/auth/login": { json: { user, access_token: "t", token_type: "bearer", expires_at: "x" } } });
    renderWithProviders(<LoginPage />, { route: "/login", path: "/login" });
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "Secret123");
    await userEvent.click(screen.getByLabelText(/Remember me/));
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({ email: "a@b.co", password: "Secret123", remember_me: true }));
  });

  it("links to the backend Google flow (with remember and next) when Google is configured", async () => {
    mockApi({ "GET /api/auth/providers": { json: { password: true, google: true } } });
    renderWithProviders(<LoginPage />, { route: "/login?next=/learning", path: "/login" });
    await userEvent.click(screen.getByLabelText(/Remember me/));
    const link = await screen.findByRole("link", { name: "Continue with Google" });
    expect(link.getAttribute("href")).toBe("/api/auth/google/start?remember=true&next=%2Flearning");
  });

  it("disables the Google button and explains why when Google is not configured", async () => {
    mockApi({ "GET /api/auth/providers": { json: { password: true, google: false } } });
    renderWithProviders(<LoginPage />);
    expect(await screen.findByText("Google sign-in isn't set up on this server yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
  });

  it("shows a translated OAuth error from the callback redirect", async () => {
    mockApi({});
    renderWithProviders(<LoginPage />, { route: "/login?oauth_error=OAUTH_ACCOUNT_EXISTS", path: "/login" });
    expect(await screen.findByRole("alert")).toHaveTextContent(/already/i);
  });
});

