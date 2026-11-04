# DocPresenter Source-Available License, version 1.0

DocPresenter is Copyright © 2026 Rintaro Sugishita.

These terms are in force from **4 November 2026**. They apply to DocPresenter as
published in this repository, on the Visual Studio Code Marketplace, and on its
web viewer page, **including versions published before that date**.

Why each clause is here is explained in [design/licensing.md](design/licensing.md)
(Japanese). That document is the reasoning; it is not part of these terms.

In short: **use it, pass it on, do not change it.** Two things are spelled out
because without them a library nobody may change is a library nobody can use:
building is not changing ([§4](#4-building-is-not-changing)), and an abandoned
library may be repaired ([§5](#5-repairs-when-the-software-is-unmaintained)).

---

## 1. Acceptance

To get any licence under these terms you must agree to them. The terms are both
obligations you take on and conditions on every licence they give you: if you
break a term, the licence that term conditions was never yours for that use.

## 2. Copyright licence

The licensor grants you a copyright licence to do everything with the software
that would otherwise infringe the licensor's copyright in it, **for any
purpose, including a commercial one**, other than:

- distributing it, which [§3](#3-distribution) covers; and
- changing it or making new works based on it, which this licence does **not**
  permit except as [§4](#4-building-is-not-changing) and
  [§5](#5-repairs-when-the-software-is-unmaintained) allow.

Running it, reading it, testing it, building it into your own software,
deploying it inside your organisation, and using its output commercially are
all permitted, with no fee and no report to anyone.

## 3. Distribution

The licensor grants you an additional copyright licence to **distribute copies
of the software**, on its own or as part of something larger, so long as what
you distribute is the software unchanged or its build output
([§4](#4-building-is-not-changing)), and you keep the notices
([§6](#6-notices)).

You may charge for the larger thing you distribute. You may not charge for the
software as such, and you may not represent it as yours.

## 4. Building is not changing

The following are **not** changes to the software, and the licence in
[§3](#3-distribution) covers distributing what they produce:

- compiling, transpiling, and downlevelling;
- bundling, tree-shaking, code splitting, and inlining;
- minifying, mangling internal names, and generating source maps;
- converting between module formats (ESM, CommonJS, UMD, a single file);
- adding or removing polyfills the target runtime requires;
- installing the software as a dependency, vendoring it into a lockfile or a
  dependency directory, and copying it into a container image or an installer;
- generating type declarations, documentation, or an index from it.

The same goes for **using** the software as it is meant to be used: calling its
published interfaces, passing it options, supplying your own theme or style
sheet, writing the files it reads, and rendering its output. None of that is a
change, whatever it does to the bytes on their way to a browser.

What is still a change: altering the software's own source or its behaviour to
make something it does not do, and distributing that. A build that faithfully
carries the software's behaviour across is covered here; a build used as a
disguise for an edit is not.

## 5. Repairs when the software is unmaintained

The software is **unmaintained** if any of these is true:

- twelve consecutive months pass with no new release and no public commit to
  its public repository;
- the licensor announces that it is discontinued or no longer supported; or
- the licensor withdraws its public repository and publishes no replacement.

While the software is unmaintained, the licensor grants you an additional
copyright licence to **make and distribute the smallest change that**:

- fixes a security vulnerability;
- restores compatibility with a runtime, platform, or dependency version the
  software no longer works with; or
- fixes a defect that stops you using the software for what you already use it
  for.

This licence is conditioned on all of the following:

1. **Keep it small.** The change addresses one of the three purposes above and
   goes no further. It is not an opportunity to add features or to fork.
2. **Say who made it.** Your distribution states plainly that the change is
   yours and not the licensor's, and does not present the result as an official
   release.
3. **Keep the name honest.** You do not use the licensor's names, marks, or
   package names for your distribution in a way that suggests the licensor
   published it. Saying that yours is "a patched copy of DocPresenter x.y.z" is
   accurate and allowed.
4. **Keep the notices.** [§6](#6-notices) still applies.

We also **ask** — this is a request, not a condition — that if you distribute
such a change publicly, you tell us about it and let us take it into the
software, on the terms we ask of contributors ([CONTRIBUTING.md](CONTRIBUTING.md)).
Declining does not affect your licence.

If the software becomes maintained again, this section stops permitting **new**
changes. Changes already made and distributed under it stay licensed, and you
may keep using and distributing them.

## 6. Notices

Anyone who gets any part of the software from you must also get a copy of these
terms and the following notice:

> DocPresenter is Copyright © 2026 Rintaro Sugishita. All rights reserved.

For build output ([§4](#4-building-is-not-changing)), it is enough to carry the
notice where the rest of your dependency notices live — a `NOTICE` file, a
third-party notices page, an `about` screen — or as a comment the build
preserves. The notice must reach the person who receives the software; it need
not survive inside a minified file.

## 7. File formats and notations are not covered

This licence covers **code**. It does not cover the **file formats and
notations** the software reads and writes, including `.dgm` and `.table`.

Those are specified in [`spec/`](spec/README.md) and **anyone may implement
them**, in any language, for any purpose, under any licence, with no permission
from the licensor and no obligation to it. Nothing in this licence should be
read as a claim over the formats, over files you write in them, or over an
independent implementation of them.

## 8. Names and marks

This licence gives you no right to the licensor's names, logos, or marks. You
may say truthfully what the software is and which version you have.

## 9. Patent licence

The licensor grants you a patent licence, on the same conditions as the
copyright licence above, covering patent claims the licensor can license, or
becomes able to license, that you would infringe by using the software as this
licence permits.

## 10. Patent defence

If you make any written claim that the software infringes or contributes to
infringement of a patent, your patent licence ends immediately. If your company
makes such a claim, your patent licence ends immediately for work on your
company's behalf.

## 11. No other rights

These terms do not give you any rights the licensor has not granted here, and
do not imply a licence from anyone other than the licensor.

These terms do not cover files that carry a licence of their own: third-party
components included with the software, which stay under their own licences
(listed in `THIRD-PARTY-NOTICES.md`), and any part the licensor publishes under
another licence, which says so in a licence file in that part's directory. The licensor is not
obliged to grant any further rights, to keep publishing the software, or to
release future versions under these terms.

## 12. Violations and termination

The first time you are notified in writing that you have broken any of these
terms, you may keep your licence if you **stop the breach and put right what it
caused within 30 days** of receiving the notice. Otherwise all your licences end immediately.

Any second breach ends all your licences immediately and permanently.

Ending your licences does not end the licence of anyone who received the
software from you and is themselves in compliance.

## 13. Moral rights

The licensor will not exercise the author's moral rights — including the right
to integrity and the right to be named, under Articles 19 and 20 of the
Copyright Act of Japan and the like elsewhere — against anything these terms
permit: building as [§4](#4-building-is-not-changing) describes, repairs as
[§5](#5-repairs-when-the-software-is-unmaintained) allows, and carrying the
notice where [§6](#6-notices) allows rather than inside every file.

## 14. No warranty, and no liability

The software is provided **free of charge and as is**, without any warranty or
condition of any kind, including that it works, that it is fit for a purpose,
that it is free of defects, or that it infringes no one's rights. You decide
whether it is fit for what you use it for, and you keep your own backups.

**The licensor will not be liable to anyone for any damage** arising out of
these terms or the use or nature of the software, under any kind of legal
claim — contract, tort, or otherwise. That includes, without limit, loss of
business, profits, revenue, or data, interruption of work, claims made against
you by others, and the cost of replacing the software.

**If you use the software for a business** — as a company or other
organisation, or as an individual acting in the course of a trade — this
exclusion applies to you in full.

**Only if you are a consumer**, and a law that cannot be set aside by agreement
(such as the Consumer Contract Act of Japan) makes the exclusion above
ineffective against you, then instead: for damage caused by the licensor's
negligence that is not gross negligence, the licensor's liability is limited to
ordinary damage arising directly from it, and excludes damage arising from
special circumstances and lost profits. This limitation applies only to
negligence that is not gross negligence.

## 15. Governing law and language

These terms are governed by the laws of Japan. The Tokyo District Court has
exclusive jurisdiction as the court of first instance over disputes arising
from them, except where a law protecting consumers lets a consumer bring or
answer a claim in another court.

The English text of these terms is the authoritative one. Any translation is
provided for convenience and does not change the terms.

## 16. Definitions

- **the licensor** — the individual or entity offering these terms, that is,
  the copyright holder named in [§6](#6-notices).
- **the software** — the work the licensor makes available under these terms,
  and any part of it.
- **you** — the individual or entity agreeing to these terms.
- **your company** — any legal entity, sole proprietorship, or other kind of
  organisation that you work for, plus all organisations that have control over,
  are under the control of, or are under common control with that organisation.
  **control** means ownership of substantially all the assets of an
  organisation, or the power to direct its management and policies by vote,
  contract, or otherwise.
- **your licences** — all the licences granted to you under these terms.
- **a change** — anything that alters the software's source or behaviour, other
  than what [§4](#4-building-is-not-changing) lists.
- **distribute** — to make available to anyone other than you and your company.
- **use** — anything you do with the software requiring one of your licences.
