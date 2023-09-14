# Vite Middleware for Web Dev Server

A middleware for Web Dev Server (WDS) and Web Test Runner (WTR) that allows requests to be
transformed and served using Vite. Rather than starting Vite's dev server alongside WDS/WTR and
proxying requests to it, this will install Vite as a middleware component inside the WDS/WTR request
pipeline.

## Installation

```sh
npm install --save-dev wds-use-vite
```

## Configuration

This package exports two functions

* `addVite` &ndash; Creates a WDS/WTR _plugin_ that is responsible for starting Vite in middleware
  mode when WDS/WTR starts.
* `useVite` &ndash; Defines a WDS/WTR _middleware_ function that inspects the current request and
  determines if it should allow the Vite middleware to process it or not.

You must configure both in order for the Vite middleware to work as intended. To do so, modify your
WDS/WTR config as follows:

```javascript
import { addVite, useVite } from 'wds-use-vite';

export default {
  plugins: [addVite()],
  middleware: [useVite()],
  // ... rest of config here ...
};
```
