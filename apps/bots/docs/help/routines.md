# Routines

A routine runs a bot on a schedule or when something happens (a webhook, a new email, a GitHub event). Each routine
has a standing grant: the actions it may take on its own, on which targets, with limits such as "at most 20 a day".
Anything outside the grant asks you first. Missed firings while a bot was busy are combined into one catch-up run.
