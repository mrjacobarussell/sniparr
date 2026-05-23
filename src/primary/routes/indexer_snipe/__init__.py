"""Indexer Hunt — centralized indexer management blueprint."""

from flask import Blueprint

indexer_snipe_bp = Blueprint('indexer_snipe', __name__)

# Import route modules so their decorators register on the blueprint
from . import indexers  # noqa: F401, E402
from . import sync      # noqa: F401, E402
from . import stats     # noqa: F401, E402
from . import history   # noqa: F401, E402
from . import health    # noqa: F401, E402
