# 2.0.1

- BUGFIX: default imports could get inserted wrong when there are preexisting named imports

# 2.0.0

- BREAKING: emit imports in a more intuitive order. Breaking because you may
  have relied on the old order.

# 1.4.1

- REVERT: I decided to release this feature as a major instead, so this is a
  republish of 1.3.0. It's too surprising for people's code evaluation order to
  change on a minor.

# 1.4.0

- FEATURE: pick a more intuitive order for the emitted import statements.

# 1.3.0

- FEATURE: automatically ensure that nameHints result in valid Javascript identifiers, so that callers don't need to bother about it.

# 1.2.2

- BUGFIX: reverting use of Babel's container-aware methods. They do indeed cause babel to schedule further processing of our emitted code, but unfortunately babel doesn't keep track of any intervening changes that are made by other plugins in between the time the work is scheduled and the time the work is done, meaning subsequent plugins can get handed totally invalid nodes that have already been removed from the tree.

# 1.2.1

- BUGFIX: explicitly remove all import specifiers so that babel will cancel scheduled visits on them.

# 1.2.0

- BUGFIX: use Babel's container-aware methods to manipulate the set of import declarations and import specifiers

# 1.1.0

- FEATURE: add support for side-effectful imports

# 1.0.0

- FEATURE: add support for namespace imports
- DOCS: write an actual README

# 0.2.0

- BUGFIX: don't share identifier nodes

# 0.1.0

- initial release
