// Re-export shim — the implementation moved to ../atoms/button during the
// UI rebuild (phase 2). Existing consumers keep importing from here via
// the package barrel; the shim collapses in phase 5 when components/ is
// dissolved.
export { Button, type ButtonProps, buttonVariants } from '../atoms/button';
