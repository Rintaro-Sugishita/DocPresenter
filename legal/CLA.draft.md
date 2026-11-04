# DocPresenter Individual Contributor Licence Agreement, version 1.0 — DRAFT

> **This is a draft. It is not in force and nobody has signed it.**
>
> No lawyer has reviewed this text. The reasoning behind it is in
> [design/licensing.md §6.7](../design/licensing.md); how it is meant to feel to
> a contributor is in [CONTRIBUTING.md](../CONTRIBUTING.md). Open questions are
> in [Notes on this draft](#notes-on-this-draft).

**You keep your copyright.** This agreement asks for a licence, not an
assignment. It is modelled on the Apache Software Foundation's Individual
Contributor Licence Agreement, with one addition Japanese law requires
([§5](#5-moral-rights)).

**Why it is needed at all.** DocPresenter is distributed under terms that do
not permit changes ([`LICENSE.md`](../LICENSE.md)). A contributor
cannot sign a `Signed-off-by` line certifying that their patch may go out under
those terms, because those terms are exactly what forbids the patch. So the
permission has to come the other way: from you, to us, once.

---

## 1. Definitions

- **You** — the individual agreeing to this agreement. If you are agreeing on
  behalf of an organisation, use the corporate agreement instead
  ([Notes](#notes-on-this-draft), item 2).
- **the project** — DocPresenter, its packages, its specifications, and its
  documentation, as published by the project owner.
- **the project owner**, **we**, **us** — Rintaro Sugishita, the copyright
  holder named in the project's licence.
- **Contribution** — any work of authorship you intentionally submit to the
  project: code, tests, documentation, specification text, samples, themes, or
  anything else. It includes the original work and any modification or addition
  to an existing work.
- **Submit** — to send a Contribution to us or to a place we use to receive
  them: a pull request, an issue, an email, or any other communication, except
  one you clearly mark **"Not a Contribution"**.

## 2. Grant of copyright licence

You grant us, and to those who receive the project from us, a **perpetual,
worldwide, non-exclusive, royalty-free, irrevocable** licence in your
Contribution to:

- reproduce it;
- prepare derivative works of it;
- publicly display and publicly perform it;
- distribute it and those derivative works; and
- **sublicense** these rights, through any number of tiers.

Under the Copyright Act of Japan, this includes the rights in Articles 27
(translation and adaptation) and 28 (the original author's rights in a
derivative work), which a grant must name to be sure of covering them.

This licence lets us distribute your Contribution **under whatever terms the
project uses, now or later, including terms that are not open source** — today
that means [the project's source-available licence](../LICENSE.md).

**You keep your copyright in your Contribution.** You may use it, publish it,
and license it to anyone else, on any terms, for any purpose. Nothing here
limits what you may do with your own work.

## 3. Grant of patent licence

You grant us, and to those who receive the project from us, a **perpetual,
worldwide, non-exclusive, royalty-free, irrevocable** licence under any patent
claims you own or control that are necessarily infringed by your Contribution
alone, or by the combination of your Contribution with the project as it stood
when you submitted it, to make, have made, use, offer to sell, sell, import,
and otherwise transfer the project.

If any entity brings a patent action alleging that the project or a
Contribution in it infringes a patent, the patent licences granted by you under
this agreement to that entity end as of the date the action is filed.

## 4. You are entitled to grant this

You represent that:

1. each Contribution is your original creation, or you have the rights needed
   to grant the licences above for the parts that are not;
2. you are legally entitled to grant these licences — in particular, if your
   employer has rights in work you create, you have permission from your
   employer to submit the Contribution, or your employer has waived those
   rights, or your employer has signed the corporate agreement; and
3. you are not aware of any third-party claim or licence affecting your
   Contribution that you have not told us about.

If a Contribution includes work that is not yours — a snippet under another
licence, generated output, a translation of someone else's text — **say so in
the submission**, clearly enough that we can see which parts are affected and
under what terms, and keep any notices the other licence requires. We may
decline such a Contribution.

## 5. Moral rights

Japanese law does not allow moral rights (著作者人格権) to be assigned or
waived. So instead: **you agree not to assert your moral rights** against us,
against anyone who receives the project from us, or against their users, as far
as necessary for us to exercise the licences in [§2](#2-grant-of-copyright-licence)
and [§3](#3-grant-of-patent-licence).

In practice this is the permission to publish your Contribution as part of the
project, to edit it, to move it, to rename things in it, and to release it
without your name attached to that particular line of code. It is not
permission to misrepresent who wrote it: where the project records
contributions, we record yours.

Outside Japan, to the extent moral rights may be waived, you waive them for the
same purposes.

## 6. What we are not promising

- **We are not obliged to use your Contribution.** We may accept it, change it,
  or decline it, for any reason or none.
- **We are not obliged to support it,** to keep it in the project, or to keep
  the project going.
- **You are not obliged to provide support** for your Contribution. Unless you
  choose to, and except for what [§4](#4-you-are-entitled-to-grant-this) says,
  your Contribution is provided **AS IS, without warranties or conditions of
  any kind**, express or implied, including any warranty of merchantability,
  fitness for a particular purpose, or non-infringement.

## 7. Telling us when something changes

If any of the facts you represented in [§4](#4-you-are-entitled-to-grant-this)
stop being true, tell us as soon as you know.

## 8. Governing law and language

This agreement is governed by the laws of Japan, and the Tokyo District Court
has exclusive jurisdiction over disputes arising from it. The English text is
the authoritative one; a translation is for convenience only.

This agreement is the whole of what you and we have agreed about your
Contributions, and replaces anything said before it.

## 9. How you agree

On your first pull request, a comment will ask you to reply with the line below.
The reply is recorded against your account, and later pull requests do not ask
again.

```
I have read the DocPresenter Contributor Licence Agreement and I agree to it.
```

If you would rather not agree, that is fine — **open an issue instead**. A good
bug report is worth more to us than most patches, and it needs no paperwork
([CONTRIBUTING.md](../CONTRIBUTING.md)).

## 10. Versions of this agreement

Each Contribution is governed by the version of this agreement you had agreed
to when you submitted it. If we publish a new version, it applies only to
Contributions you submit after agreeing to it; until you do, we will not take
new Contributions from you under the old one without saying so.

---

## Notes on this draft

Checked without a lawyer (reasoning in [design/licensing.md §8](../design/licensing.md)):

- **Moral rights** ([§5](#5-moral-rights)): Japanese law makes them personal to
  the author (Copyright Act Article 59), so a covenant not to assert them is the
  usual construction; it is kept, scoped to what the licences need.
- **Articles 27 and 28** are now named in [§2](#2-grant-of-copyright-licence).
  Article 61(2) presumes they stay with the author when copyright is
  *transferred* unless named; this is a licence, not a transfer, but naming them
  removes the doubt for "prepare derivative works".
- **Versions**: [§10](#10-versions-of-this-agreement) says the version agreed to
  governs, as Apache does.

Still open:

1. **A lawyer's reading**, should one ever be affordable.
2. **A corporate agreement (CCLA)** is not drafted. Apache's split of ICLA and
   CCLA is the model; until the CCLA exists, a contributor submitting work their
   employer owns needs an individual permission from that employer
   ([§4](#4-you-are-entitled-to-grant-this), item 2).
3. **The agreement mechanism.** [§9](#9-how-you-agree) assumes a CLA bot that
   records a reply against a GitHub account. Which bot, and where the record
   lives, is undecided; a click-through record must survive the repository
   moving.
4. **Specification contributions.** `spec/` is
   [free for anyone to implement](../spec/README.md), but its *text* is still
   copyrighted. A correction to the spec is a Contribution under this agreement
   like any other; confirm that this is what we want, rather than putting
   `spec/` under a permissive licence of its own.
