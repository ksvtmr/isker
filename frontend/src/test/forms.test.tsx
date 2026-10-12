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
    expect(calls).toHaveLength(0);
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
    expect(calls[0].body).toEqual({ email: "a@b.co", password: "Secret123" });
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
    expect(await screen.findByText("An account with this email already exists.")).toBeInTheDocument();
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
    expect(calls).toHaveLength(0);
    await userEvent.click(screen.getByLabelText(/I agree to the/));
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByTestId("location")).toBeInTheDocument();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ full_name: "Dana Learner", email: "a@b.co", password: "Secret123", accept_terms: true });
  });
});
