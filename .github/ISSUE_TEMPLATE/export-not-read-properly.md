---
name: An export is not read properly
about: Something is missing, wrong, or unreadable when you open your export
title: "[service] short description"
labels: export
---

## What you opened

Which service, roughly when you requested it, and which country or language the
account is in. Language matters more than it sounds: several services translate
their own folder names.

## What you expected, and what you got

For example: "5,000 photos, got 300", or "every message shows the same name", or
"it says 0 items".

## The structure report

This is the useful part, and it contains none of your data.

Open your export, go to **What is in here**, and download the report. It holds
folder names, file types, column headers and row counts. No values. File names
are reduced to their shape, so `Holiday in Rome.jpg` becomes `Aaaaaaa aa Aaaa.jpg`.

**Read it before you attach it.** It is meant to be readable, and if there is
something in it you would rather not share, say so and describe the problem in
words instead - that is still useful.

<details>
<summary>report.json</summary>

```json
paste here, or drag the file into this box
```

</details>

## Your browser

Browser and version, and operating system. Also whether the folder picker
appeared or you were asked for a zip file, since those are two different code
paths and one of them is far less tested.
