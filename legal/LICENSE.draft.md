# DocPresenter Source-Available License, version 1.0 — DRAFT

> **This is a draft. It is not in force and grants nothing.**
>
> No lawyer has reviewed this text. Until a release of DocPresenter ships a
> licence file of its own, the software in this repository is under
> "all rights reserved" and this document is only the wording we intend to use.
> Read [design/licensing.md](../design/licensing.md) for why each clause is
> here; that document is the reasoning, this one is the wording.
>
> Open questions are collected in [Notes on this draft](#notes-on-this-draft)
> and must be settled before the first release.

This licence is modelled on the **PolyForm Strict License 1.0.0**
(<https://polyformproject.org/licenses/strict/1.0.0/>), which says
"use it, pass it on, do not change it" in fewer words than anyone else manages.
Two things PolyForm Strict does not say had to be added, because without them a
library nobody may change is a library nobody can use: building is not
changing ([§4](#4-building-is-not-changing)), and an abandoned library may be
repaired ([§5](#5-repairs-when-the-software-is-unmaintained)).

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
5. **Offer it back.** If you distribute the change publicly, you grant the
   licensor the same licence to that change that the
   [Contributor Licence Agreement](CLA.draft.md) would give, and you make the
   change available to the licensor on request.

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

Those are specified in [`spec/`](../spec/README.md) and **anyone may implement
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
do not imply a licence from anyone other than the licensor. The licensor is not
obliged to grant any further rights, to keep publishing the software, or to
release future versions under these terms.

## 12. Violations and termination

The first time you are found to have broken any of these terms, you may keep
your licence if you **stop the breach and put right what it caused within 30
days** of being told about it. Otherwise all your licences end immediately.

Any second breach ends all your licences immediately and permanently.

Ending your licences does not end the licence of anyone who received the
software from you and is themselves in compliance.

## 13. No liability and no warranty

***As far as the law allows, the software comes AS IS, without any warranty or
condition, and the licensor will not be liable to anyone for any damages or
other liability arising out of these terms or the use of or nature of the
software, under any kind of legal claim.***

## 14. Governing law and language

These terms are governed by the laws of Japan, and the Tokyo District Court has
exclusive jurisdiction over disputes arising from them.

The English text of these terms is the authoritative one. Any translation is
provided for convenience and does not change the terms.

## 15. Definitions

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

---

## Notes on this draft

To settle before the first release:

1. **Legal review.** The whole text, but especially [§5](#5-repairs-when-the-software-is-unmaintained)
   (is "unmaintained" defined tightly enough to be workable, and loosely enough
   to reassure an adopter?) and [§12](#12-violations-and-termination) (a cure
   period of 30 days, once).
2. **Name.** "DocPresenter Source-Available License" assumes the product name.
   The drawing tool [has no public name yet](../design/packaging.md).
3. **The offer-back condition** ([§5](#5-repairs-when-the-software-is-unmaintained), item 5)
   is a decision this draft makes and `design/licensing.md` did not: a public
   self-defence fix comes with a licence back to us. It solves the problem
   [§6.6 of the policy](../design/licensing.md) describes — a fork we cannot
   take code from — for the one case where we allowed the fork in the first
   place. Confirm we want it; it is a condition, so ignoring it makes the fix
   unlicensed, which is a heavier consequence than it may look.
4. **Whether to reuse PolyForm's own wording.** Modelling on PolyForm Strict is
   not the same as using its text. If we want its text, check how the PolyForm
   project asks its licences to be reused and renamed.
5. **Relicensing the relay server.** The relay server is to be
   [open source](../design/platforms.md) (MIT or Apache-2.0); it must be
   excluded from this licence's scope by directory, in writing.
6. **Bundled third-party material.** `THIRD-PARTY-NOTICES` and the Noto font
   attribution are separate obligations this licence does not discharge.
