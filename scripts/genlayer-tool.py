import os
import sys
from pathlib import Path


CACHE_ENV = "GENLAYER_SENTINEL_GENVM_CACHE"
VERSION_ENV = "GENVM_VERSION"
DEFAULT_VERSION = "v0.2.16"
CONTRACT = Path("intelligent-contract/sentinel_policy.py")


def _repository_cache() -> Path:
    raw = os.environ.get(CACHE_ENV)
    if not raw:
        raise RuntimeError(f"{CACHE_ENV} is required")
    cache = Path(raw).resolve()
    repository = Path.cwd().resolve()
    if not cache.is_relative_to(repository):
        raise RuntimeError("GenLayer cache must be inside the repository")
    return cache


def _configure_linter_cache(cache: Path):
    from genvm_linter.validate import artifacts

    artifacts.CACHE_DIR = cache
    return artifacts


def _configure_direct_cache(cache: Path):
    from gltest.direct import sdk_loader

    sdk_loader.CACHE_DIR = cache
    return sdk_loader


def _prepare() -> None:
    cache = _repository_cache()
    version = os.environ.get(VERSION_ENV, DEFAULT_VERSION)
    artifacts = _configure_linter_cache(cache)
    tarball = artifacts.download_artifacts(version)
    direct_loader = _configure_direct_cache(cache)
    paths = direct_loader.setup_sdk_paths(CONTRACT, version=version)
    if not paths or any(not path.resolve().is_relative_to(cache) for path in paths):
        raise RuntimeError("GenLayer SDK resolved outside the repository cache")
    print(f"GenVM direct cache prepared: {cache.relative_to(Path.cwd())} ({version})")
    print(f"GenVM runner bundle: {tarball.name}")


def _lint() -> None:
    cache = _repository_cache()
    version = os.environ.get(VERSION_ENV, DEFAULT_VERSION)
    tarball = cache / f"genvm-universal-{version}.tar.xz"
    if not tarball.is_file():
        raise RuntimeError(
            "GenLayer SDK cache is missing; run npm run setup:ic:direct"
        )
    _configure_linter_cache(cache)
    from genvm_linter.cli import cli

    cli()


def main() -> None:
    if len(sys.argv) < 2:
        raise RuntimeError("expected prepare or lint")
    mode = sys.argv.pop(1)
    if mode == "prepare":
        _prepare()
    elif mode == "lint":
        _lint()
    else:
        raise RuntimeError("expected prepare or lint")


if __name__ == "__main__":
    main()
