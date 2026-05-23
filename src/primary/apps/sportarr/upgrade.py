#!/usr/bin/env python3
"""
Quality Upgrade Processing for Sportarr
Handles searching for items that need quality upgrades in Sportarr
"""

import time
import random
from typing import Dict, Any, List, Callable
from datetime import datetime, timedelta
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
from src.primary.apps._common.tagging import try_tag_item, extract_tag_settings

sportarr_logger = get_logger("sportarr")


def process_cutoff_upgrades(
    app_settings: Dict[str, Any],
    stop_check: Callable[[], bool]
) -> bool:
    """
    Process quality cutoff upgrades for Sportarr based on settings.

    Args:
        app_settings: Dictionary containing all settings for Sportarr
        stop_check: A function that returns True if the process should stop

    Returns:
        True if any items were processed for upgrades, False otherwise.
    """
    sportarr_logger.info("Starting quality cutoff upgrades processing cycle for Sportarr.")
    processed_any = False

    check_state_reset("sportarr")

    s = extract_app_settings(app_settings, "sportarr", "hunt_upgrade_items", "Sportarr Default")
    instance_name = s['instance_name']
    instance_key = s['instance_key']
    api_url = s['api_url']
    api_key = s['api_key']
    api_timeout = s['api_timeout']
    monitored_only = s['monitored_only']
    hunt_upgrade_items = s['hunt_count']
    tag_settings = extract_tag_settings(app_settings)

    if not validate_settings(api_url, api_key, hunt_upgrade_items, "sportarr", sportarr_logger):
        return False

    if stop_check():
        sportarr_logger.info("Stop requested before starting quality upgrades. Aborting...")
        return False

    sportarr_logger.info("Retrieving items eligible for cutoff upgrade...")
    upgrade_eligible_data = sportarr_api.get_cutoff_unmet_items(api_url, api_key, api_timeout, monitored_only)

    if not upgrade_eligible_data:
        sportarr_logger.info("No items found eligible for upgrade or error retrieving them.")
        return False

    if stop_check():
        sportarr_logger.info("Stop requested after retrieving upgrade eligible items. Aborting...")
        return False

    sportarr_logger.info(f"Found {len(upgrade_eligible_data)} items eligible for quality upgrade.")

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
            upgrade_eligible_data = [item for item in upgrade_eligible_data if item.get("seriesId") not in exempt_series_ids]
            sportarr_logger.info(f"Exempt tags filter: {len(upgrade_eligible_data)} items remaining for upgrades after excluding series with exempt tags.")

    unprocessed_items = filter_unprocessed(
        upgrade_eligible_data, "sportarr", instance_key,
        get_id_fn=lambda item: item.get("id"), logger=sportarr_logger
    )
    sportarr_logger.info(f"Found {len(unprocessed_items)} unprocessed items out of {len(upgrade_eligible_data)} total items eligible for quality upgrade.")

    if not unprocessed_items:
        sportarr_logger.info(f"No unprocessed items found for {instance_name}. All available items have been processed.")
        return False

    items_processed = 0
    processing_done = False

    sportarr_logger.info(f"Randomly selecting up to {hunt_upgrade_items} items for quality upgrade.")
    items_to_upgrade = random.sample(unprocessed_items, min(len(unprocessed_items), hunt_upgrade_items))

    sportarr_logger.info(f"Selected {len(items_to_upgrade)} items for quality upgrade.")

    for item in items_to_upgrade:
        if not should_continue_processing("sportarr", stop_check, sportarr_logger):
            break

        current_limit = app_settings.get("hunt_upgrade_items", 1)
        if items_processed >= current_limit:
            sportarr_logger.info(f"Reached HUNT_UPGRADE_ITEMS limit ({current_limit}) for this cycle.")
            break

        item_id = item.get("id")
        title = item.get("title", "Unknown Title")
        season_episode = f"S{item.get('seasonNumber', 0):02d}E{item.get('episodeNumber', 0):02d}"

        current_quality = item.get("episodeFile", {}).get("quality", {}).get("quality", {}).get("name", "Unknown")

        sportarr_logger.info(f"Processing item for quality upgrade: \"{title}\" - {season_episode} (Item ID: {item_id})")
        sportarr_logger.info(f" - Current quality: {current_quality}")

        if stop_check():
            sportarr_logger.info(f"Stop requested before searching for {title}. Aborting...")
            break

        add_processed_id("sportarr", instance_key, str(item_id))
        sportarr_logger.debug(f"Added item ID {item_id} to processed list for {instance_name}")

        sportarr_logger.info(" - Searching for quality upgrade...")
        search_command_id = sportarr_api.item_search(api_url, api_key, api_timeout, [item_id])
        if search_command_id:
            sportarr_logger.info(f"Triggered search command {search_command_id}. Assuming success for now.")

            series_id = item.get('seriesId')
            if series_id:
                try_tag_item(tag_settings, "upgraded", sportarr_api.tag_processed_series,
                             api_url, api_key, api_timeout, series_id,
                             sportarr_logger, f"series {series_id}")

            series_title = item.get("series", {}).get("title", "Unknown Series")
            media_name = f"{series_title} - {season_episode} - {title}"
            log_processed_media("sportarr", media_name, item_id, instance_key, "upgrade", display_name_for_log=app_settings.get("instance_display_name") or instance_name)
            sportarr_logger.debug(f"Logged quality upgrade to history for item ID {item_id}")

            items_processed += 1
            processing_done = True

            increment_stat("sportarr", "upgraded", 1, instance_key)
            sportarr_logger.debug("Incremented sportarr upgraded statistics by 1")

            current_limit = app_settings.get("hunt_upgrade_items", 1)
            sportarr_logger.info(f"Processed {items_processed}/{current_limit} items for quality upgrade this cycle.")
        else:
            sportarr_logger.warning(f"Failed to trigger search command for item ID {item_id}.")
            continue

    if items_processed > 0:
        sportarr_logger.info(f"Completed processing {items_processed} items for quality upgrade for this cycle.")
    else:
        sportarr_logger.info("No new items were processed for quality upgrade in this run.")

    return processing_done
