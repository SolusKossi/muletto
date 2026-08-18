# Contributing

The most useful thing anyone can give this project is a service it does not
read properly yet. That does not require writing any code, and it does not
require sending anyone your data.

## Reporting an export that is read wrongly

Open an issue using the "An export is not read properly" template. Attach the
structure report, which the app writes for exactly this purpose: folder names,
file types, column headers and row counts, with no values, and file names
reduced to their shape.

Read the report before attaching it. It is meant to be readable. If there is
something in it you would rather not share, describe the problem in words
instead - that is still worth having.

**Please do not attach an export, or offer to send one.** It will not be
accepted. The report is enough, and `tools/rebuild-from-report.js` turns one
back into a working archive with invented contents, which reproduces the shape
of the problem without reproducing anything of yours.

## Sending code

Pull requests are welcome for parsers and format readers. That is where most
of the work is, and where the formats change underneath us. Before opening one:

- Run `node tools/build-site.js` then `node tools/check.js`. The checks enforce
  plain ASCII, no inline scripts, no broken internal links, generated pages
  matching their source, and the counts the README states.
- Attach a rebuilt archive if you can. One is worth more than a description,
  and `tools/check-export.js` will run it through the shipped parser.
- Update `TESTPLAN.md` in the same commit. It records how far each thing has
  been proved, and a change that moves a row should say so there.

Comments here explain why something is the way it is, usually because the
obvious approach was tried first and broke. If you fix something subtle, leave
the reason behind.

## What will not be merged

- Anything that adds a host to `connect-src` in `apps/web/_headers`. That policy
  is what makes the privacy claim enforceable rather than aspirational. If a
  change genuinely needs it, open an issue first and expect it to be argued
  about, and `privacy.html` has to change in the same commit.
- Anything that uploads, transmits, or reports on a reader's data, including
  analytics and error reporting.
- Dependencies. The app has none on purpose and loads no third-party script.

## Licence

Contributions are accepted under the same terms as the project. See `LICENSE` -
source available, noncommercial. It is not OSI open source and is not described
as such anywhere.
