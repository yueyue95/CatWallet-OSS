# Changelog

All notable changes to CatWallet will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added

- Local Supabase integration coverage for transaction commit boundaries and idempotent retries.
- Simplified CatWallet navigation and quick-entry transaction flow for daily use.
- Simplified Chinese translations for the primary dashboard, transaction, budget, report, and settings actions.

### Changed

- Transaction creation now separates a committed database write from revalidation, refresh, and navigation warnings, and prevents duplicate rapid submissions.
- Default currency and shared currency formatting now use MYR with the RM symbol and two decimal places.
- New users receive Cash, Bank, Credit Card, and Debit Card payment methods; existing payment methods remain unchanged.
- Dashboard prioritizes the monthly safe-to-spend amount and its main deductions.
- Simplified Chinese now covers the primary payment-account, transaction-history, installment, category, goal, report, settings, dialog, empty-state, validation, and toast copy.
- Payment terminology is standardized as 支付账户, 信用卡账单, 结账日, and 到期还款日 throughout zh-CN.

## [v0.1.0] - 2026-05-08

### Added

- Initial upstream personal finance dashboard.
- Google OAuth authentication with Supabase Auth.
- Supabase Postgres schema for profiles, categories, payment methods, transactions, monthly budgets, and goals.
- Row Level Security for user-owned finance data.
- Default categories and payment methods created after user registration.
- Transaction management.
- Payment method management, including credit card closing and due-day support.
- Budget split chart.
- Expenses by category chart.
- Goals tab.
- Forecast/scheduled expense support.
- Regional currency preference for BRL, USD, and EUR.
- i18n support.
- Vitest test setup with coverage.
- Open-source contribution templates.
- Security documentation.
- CI pipeline for lint, tests with coverage, and build.

### Security

- Supabase RLS policies for user data isolation.
- SQL hardening guidance and security documentation.
- No service-role credential usage in client-rendered code.

### Notes

This is the first upstream MVP release preserved in CatWallet's history notes.
