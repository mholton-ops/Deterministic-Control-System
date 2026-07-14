# Glossary

This project models a specialized physical-goods workflow, but its control patterns apply broadly to distributed operations. The terms below translate demo-specific labels into plain operational language.

## Control Terms

- **Truth at origin**: recording what happened, where it happened, and who recorded it at the time of the event.
- **Transaction envelope**: a persistent command-intent record with immutable identity, origin, payload, and dependencies plus controlled validation and delivery status.
- **Evidence bundle**: the images, notes, measurements, location data, or other proof required to support a critical state change.
- **Controlled origin**: a rule allowing state-changing events only from approved people, devices, systems, or operating contexts.
- **Additive correction**: correcting an error with a new traceable event instead of rewriting accepted history.
- **Reconstructability**: explaining a represented record through its connected command, evidence, custody, valuation, ledger, and settlement proof chain.
- **Divergence**: a difference between expected state and observed state.
- **Reconciliation case**: an owned investigation used to explain and resolve a divergence.
- **Estimated state**: a controlled provisional value used while final measurement is still unavailable.
- **Finalized state**: the reconciled result after required measurement, review, and approval are complete.
- **No floating money**: every financial movement must connect to an operating event, accountable owner, and stated purpose.

## Demo Domain Terms

- **Tracked unit** (`converter` in some source identifiers): one individual physical item recorded at intake and followed through later processing.
- **Container** (`box` in some source identifiers): the first custody grouping for multiple tracked units.
- **Processing batch** (`queue` in some source identifiers): a group kept together through processing, measurement, valuation, and final payment.
- **Material in transit (MIT)**: a tracked batch moving between custody locations.
- **Grading library** (`Smart Library` in the demo): a qualified reference set used to identify an item and estimate its expected value.
- **Laboratory measurement** (`assay` in the demo): the result used to determine the quantity and quality of recoverable material after processing.
- **X-ray fluorescence (XRF)**: a measurement method used to estimate material composition.
- **Matrix correction**: a calibration adjustment applied to a raw instrument reading.
- **Market-price exposure**: the amount of expected value that can still change as market prices move.
- **Market-price coverage** (`hedging` in some source identifiers): an action that offsets some market-price exposure so changing prices have less effect on margin.
- **Final payment** (`settlement` in some source identifiers): the reconciled amount due after custody, measurement, valuation, prior payments, and adjustments are accounted for.
- **Remaining uncovered exposure** (`need hedged` in some source identifiers): the portion of expected value that is still sensitive to changing market prices.
