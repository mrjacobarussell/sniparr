#!/usr/bin/env python3
"""
Missing Items Processing for Sportarr
Handles searching for missing sports events in Sportarr
"""

import time
import random
import datetime
from typing import List, Dict, Any, Set, Callable
from src.primary.utils.logger import get_logger
from src.primary.apps.sportarr import api as sportarr_api
from src.primary.settings_manager import load_settings, get_advanced_setting
from src.primary.stateful_manager import add_processed_id
from src.primary.stats_manager import increment_stat
from src.primary.utils.history_utils import log_processed_media
from src.primary.state import check_state_reset
from src.primary.apps._common.settings import extract_app_settings, validate_settings
from src.primary.apps._common.filtering import filter_unprocessed
from src.primary.apps._common.processing import should_continue_processing
from src.primary.apps._common.tagging import try_tag_item

sportarr_logger = get_logger("sportarr")


def process_missing_items(
    app_settings: Dict[str, Any],
    stop_check: Callable[[], bool]
) -> bool:
    """
    Process missing items in Sportarr based on provided settings.

    Args:
        app_settings: Dictionary containing all settings for Sportarr
        stop_check: A function that returns True if the process should stop

    Returns:
        True if any items were processed, False otherwise.
    """
    sportarr_logger.info("Starting missing items processing cycle for Sportarr.")
    processed_any = False

    check_state_reset("sportarr")

    s = extract_app_settings(app_settings, "sportarr", "hunt_missing_items", "Sportarr Default")
    instance_name = s['instance_name']
    instance_key = s['instance_key']
    api_url = s['api_url']
    api_key = s['api_key']
    api_timeout = s['api_timeout']
    monitored_only = s['monitored_only']
    hunt_missing_items = s['hunt_count']
    tag_settings = s['tag_settings']

    skip_future_releases = app_settings.get("skip_future_releases", True)

    if not validate_settings(api_url, api_key, hunt_missing_items, "sportarr", sportarr_logger):
        return False

    if stop_check():
        sportarr_logger.info("Stop requested before starting missing items. Aborting...")
        return False

    sportarr_logger.info("Retrieving items with missing files...")
    missing_items = sportarr_api.get_items_with_missing(api_url, api_key, api_timeout, monitored_only)

    if missing_items is None:
        sportarr_logger.error("Failed to retrieve missing items from Sportarr API.")
        return False

    if not missing_items:
        sportarr_logger.info("No missing items found.")
        return False

    if stop_check():
        sportarr_logger.info("Stop requested after retrieving missing items. Aborting...")
        return False

    sportarr_logger.info(f"Found {len(missing_items)} items with missing files.")

    if skip_future_releases:
        now = datetime.datetime.now().replace(tzinfo=datetime.timezone.utc)
        original_count = len(missing_items)
        missing_items = [
            item for item in missing_items
            if not item.get('airDateUtc') or (
                item.get('airDateUtc') and
                datetime.datetime.fromisoformat(item['airDateUtc'].replace('Z', '+00:00')) < now
            )
        ]
        skipped_count = original_count - len(missing_items)
        if skipped_count > 0:
            sportarr_logger.info(f"Skipped {skipped_count} future event releases based on air date.")

    if not missing_items:
        sportarr_logger.info("No missing items left to process after filtering future releases.")
        return False

    exempt_tags = app_settings.get("exempt_tags") or []
    if exempt_tags:
        exempt_id_to_label = sportarr_api.get_exempt_tag_ids(api_url, api_key, api_timeout, exempt_tags)
        if exempt_id_to_label:
            all_series = sportarr_api.get_series(api_url, api_key, api_timeout)
            exempt_series_ids = set()
            if all_series:
                if not isinstance(all_series, list):
                    all_series = [all_series]
                for s in all_series:
                    for tid in (s.get("tags") or []):
                        if tid in exempt_id_to_label:
                            exempt_series_ids.add(s.get("id"))
                            sportarr_logger.info(
                                f"Skipping series \"{s.get('title', 'Unknown')}\" (ID: {s.get('id')}) - has exempt tag \"{exempt_id_to_label[tid]}\""
                            )
                            break
            missing_items = [item for item in missing_items if item.get("seriesId") not in exempt_series_ids]
            sportarr_logger.info(f"Exempt tags filter: {len(missing_items)} items remaining after excluding series with exempt tags.")

    unprocessed_items = filter_unprocessed(
        missing_items, "sportarr", instance_key,
        get_id_fn=lambda item: item.get("id"), logger=sportarr_logger
    )
    sportarr_logger.info(f"Found {len(unprocessed_items)} unprocessed items out of {len(missing_items)} total items with missing files.")

    if not unprocessed_items:
        sportarr_logger.info(f"No unprocessed items found for {instance_name}. All available items have been processed.")
        return False

    items_processed = 0
    processing_done = False

    sportarr_logger.info(f"Randomly selecting up to {hunt_missing_items} missing items.")
    items_to_search = random.sample(unprocessed_items, min(len(unprocessed_items), hunt_missing_items))

    sportarr_logger.info(f"Selected {len(items_to_search)} missing items to search.")

    for item in items_to_search:
        if not should_continue_processing("sportarr", stop_check, sportarr_logger):
            break

        current_limit = app_settings.get("hunt_missing_items", 1)
        if items_processed >= current_limit:
            sportarr_logger.info(f"Reached HUNT_MISSING_ITEMS limit ({current_limit}) for this cycle.")
            break

        item_id = item.get("id")
        title = item.get("title", "Unknown Title")
        season_episode = f"S{item.get('seasonNumber', 0):02d}E{item.get('episodeNumber', 0):02d}"

        sportarr_logger.info(f"Processing missing item: \"{title}\" - {season_episode} (Item ID: {item_id})")

        add_processed_id("sportarr", instance_key, str(item_id))
        sportarr_logger.debug(f"Added item ID {item_id} to processed list for {instance_name}")

        if stop_check():
            sportarr_logger.info(f"Stop requested before searching for {title}. Aborting...")
            break

        sportarr_logger.info(" - Searching for missing item...")
        search_command_id = sportarr_api.item_search(api_url, api_key, api_timeout, [item_id])
        if search_command_id:
            sportarr_logger.info(f"Triggered search command {search_command_id}. Assuming success for now.")

            series_id = item.get('seriesId')
            if series_id:
                try_tag_item(tag_settings, "missing", sportarr_api.tag_processed_series,
                             api_url, api_key, api_timeout, series_id,
                             sportarr_logger, f"series {series_id}")

            media_name = f"{title} - {season_episode}"
            log_processed_media("sportarr", media_name, item_id, instance_key, "missing", display_name_for_log=app_settings.get("instance_display_name") or instance_name)
            sportarr_logger.debug(f"Logged history entry for item: {media_name}")

            items_processed += 1
            processing_done = True

            increment_stat("sportarr", "hunted", 1, instance_key)
            sportarr_logger.debug("Incremented sportarr hunted statistics by 1")

            current_limit = app_settings.get("hunt_missing_items", 1)
            sportarr_logger.info(f"Processed {items_processed}/{current_limit} missing items this cycle.")
        else:
            sportarr_logger.warning(f"Failed to trigger search command for item ID {item_id}.")
            continue

    if items_processed > 0:
        sportarr_logger.info(f"Completed processing {items_processed} missing items for this cycle.")
    else:
        sportarr_logger.info("No new missing items were processed in this run.")

    return processing_done
