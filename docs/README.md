# Coding Workshop — Upstream Brief

> **Main Guide** | [Validation Guide](./validation.md) | [Evaluation Guide](./evaluation.md) | [Testing Guide](./testing.md) | [Implementation Guide](./implementation.md)

> ### 📐 Looking for the spec of *this* implementation?
>
> This `docs/` folder is the **upstream
> [Citi `coding-workshop-participant`](https://github.com/citi/coding-workshop-participant)
> brief** — the generic workshop scaffold, evaluation rubric, and testing
> guide. It tells you what the workshop expects from any participant.
>
> The concrete product built in this repo (ACME Project Tracker — stack
> choices, schema, API, RBAC, deployment) is defined in
> [`../SYSTEM_DESIGN.md`](../SYSTEM_DESIGN.md). Where the brief and
> `SYSTEM_DESIGN.md` disagree, **`SYSTEM_DESIGN.md` wins** for this repo
> (see its §1 "Brief deviation" row — e.g. MUI was dropped in favour of
> Tailwind-only).

This folder contains a comprehensive set of documentation to guide you through building a complete web application that meets all specifications and requirements. The goal is to evaluate your effectiveness in delivering a fully working application. Your implementation will be assessed against expected deliverables and milestones.

## Learning Objectives

By completing this workshop, you will:

- [x] Create responsive React applications (this repo uses Tailwind-only — see `SYSTEM_DESIGN.md` §4.1)
- [x] Understand microservices architecture (or services-oriented architecture)
- [x] Build RESTful APIs with Python (or similar language)
- [x] Experience relational databases with PostgreSQL (or similar database)
- [x] Write comprehensive tests
- [x] Deploy applications to AWS Serverless
- [x] Follow software engineering best practices
- [x] Deliver a production-ready application

## Prerequisites

Before starting, ensure you have:

- Access to your [GitHub](https://github.com) account.
- Access to your [LocalStack](https://www.localstack.cloud) account.
- Email from your workshop organizer(s) with details such as Registration Code, Event ID, Participant ID, and Participant Code.
- Access to pre-installed AWS Serverless environment (you will need Event ID, Participant ID and Participant Code).
- Access to pre-installed VDI (Virtual Desktop) instance (you will need Registration Code, Participant ID and Participant Code):
  - Connect to VDI through [WorkSpaces WebUI](https://webclient.amazonworkspaces.com/), or
  - Install VDI client through [WorkSpaces Client](https://clients.amazonworkspaces.com/) on your personal computer / laptop.

## Next Steps

1. Read [`../SYSTEM_DESIGN.md`](../SYSTEM_DESIGN.md) — it is the canonical spec for the implementation in this repo.
2. Follow the [Validation Guide](./validation.md) to make sure your development environment includes all prerequisites and requirements.
3. Review the [Evaluation Guide](./evaluation.md) to understand how your implementation will be assessed and evaluated.
4. Explore the [Testing Guide](./testing.md) to make sure your implementation doesn't miss important aspects of development lifecycle.
5. Check the [Implementation Guide](./implementation.md) to get directions and guidelines on implementation expectations.

## Navigation Links

<nav aria-label="breadcrumb">
  <ol>
    <li aria-current="page">Main Guide</li>
    <li><a href="./validation.md">Validation Guide</a></li>
    <li><a href="./evaluation.md">Evaluation Guide</a></li>
    <li><a href="./testing.md">Testing Guide</a></li>
    <li><a href="./implementation.md">Implementation Guide</a></li>
  </ol>
</nav>
