# Pinned UMA interfaces

Upstream: https://github.com/UMAprotocol/protocol

Revision: `c8c3f67367afd1c767712a3dbe3c8cad01b9a4d8`

Both Solidity files are unmodified downloads from
`packages/core/contracts/optimistic-oracle-v3/interfaces/` at that revision.
The upstream root LICENSE is included. Preserve the AGPL-3.0-only notices.

SHA-256 (LF-normalized, checked by the local test suite):

| File | Hash |
| --- | --- |
| OptimisticOracleV3Interface.sol | `3a32922de084694b0e7fa29cf4a8f026eb9e6fb594fe3c54a52023f409604441` |
| OptimisticOracleV3CallbackRecipientInterface.sol | `e5f01fed607c621a7a9ed52c98205aa8821d710a637a071a9df0d65fe599c8e1` |

The interfaces' ^0.8.16 pragmas are compatible with this project's 0.8.34
compiler and existing OpenZeppelin 5.6.1 IERC20 interface. No UMA runtime
implementation or transitive UMA dependency graph is imported. The actual UMA
implementation at this revision pins Solidity 0.8.16 and is not compiled here.
Official CTF remains the project's pinned 1.0.3 package with Solidity 0.5.10.

An interface pin establishes ABI/source provenance for these files, not proof
that the Sepolia provider runtime matches this source revision. Verify that
separately before any bridge deployment. TestUmaOracle is an educational fixture,
not this official implementation or a DVM emulator.
