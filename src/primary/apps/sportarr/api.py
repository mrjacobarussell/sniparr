#!/usr/bin/env python3
"""
Sportarr-specific API functions
Handles all communication with the Sportarr API (v3)
"""

import requests
import json
import time
import traceback
import sys
from typing import List, Dict, Any, Optional, Union
from src.primary.utils.logger import get_logger
from src.primary.settings_manager import get_ssl_verify_setting

sportarr_logger = get_logger("sportarr")

session = requests.Session()


def arr_request(api_url: str, api_key: str, api_timeout: int, endpoint: str, method: str = "GET", data: Dict = None, count_api: bool = True) -> Any:
    """Make a request to the Sportarr API."""
    try:
        if not api_url or not api_key:
            sportarr_logger.error("No URL or API key provided")
            return None

        if not (api_url.startswith('http://') or api_url.startswith('https://')):
            sportarr_logger.error(f"Invalid URL format: {api_url} - URL must start with http:// or https://")
            return None

        full_url = f"{api_url.rstrip('/')}/api/v3/{endpoint.lstrip('/')}"

        headers = {
            "X-Api-Key": api_key,
            "Content-Type": "application/json",
            "User-Agent": "Sniparr/1.0 (https://github.com/plexguide/Sniparr.io)"
        }

        verify_ssl = get_ssl_verify_setting()

        if not verify_ssl:
            sportarr_logger.debug("SSL verification disabled by user setting")

        try:
            if method.upper() == "GET":
                response = session.get(full_url, headers=headers, timeout=api_timeout, verify=verify_ssl)
            elif method.upper() == "POST":
                response = session.post(full_url, headers=headers, json=data, timeout=api_timeout, verify=verify_ssl)
            elif method.upper() == "PUT":
                response = session.put(full_url, headers=headers, json=data, timeout=api_timeout, verify=verify_ssl)
            elif method.upper() == "DELETE":
                response = session.delete(full_url, headers=headers, timeout=api_timeout, verify=verify_ssl)
            else:
                sportarr_logger.error(f"Unsupported HTTP method: {method}")
                return None

            response.raise_for_status()

            if count_api:
                try:
                    from src.primary.stats_manager import increment_hourly_cap
                    from src.primary.utils.clean_logger import get_instance_name_for_cap
                    instance_name = get_instance_name_for_cap()
                    increment_hourly_cap("sportarr", 1, instance_name=instance_name)
                except Exception as e:
                    sportarr_logger.warning(f"Failed to increment API counter for sportarr: {e}")

            if response.content:
                try:
                    return response.json()
                except json.JSONDecodeError as jde:
                    sportarr_logger.error(f"Error decoding JSON response from {endpoint}: {str(jde)}")
                    sportarr_logger.error(f"Response status code: {response.status_code}")
                    sportarr_logger.error(f"Response content (first 200 chars): {response.content[:200]}")
                    return None
            else:
                sportarr_logger.debug(f"Empty response content from {endpoint}, returning empty dict")
                return {}

        except requests.exceptions.RequestException as e:
            error_details = str(e)
            if hasattr(e, 'response') and e.response is not None:
                error_details += f", Status Code: {e.response.status_code}"
                if e.response.content:
                    error_details += f", Content: {e.response.content[:200]}"

            sportarr_logger.error(f"Error during {method} request to {endpoint}: {error_details}")
            return None
    except Exception as e:
        error_msg = f"CRITICAL ERROR in arr_request: {str(e)}"
        sportarr_logger.error(error_msg)
        sportarr_logger.error(f"Full traceback: {traceback.format_exc()}")
        print(error_msg, file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr)
        return None


def check_connection(api_url: str, api_key: str, api_timeout: int) -> bool:
    """Checks connection by fetching system status."""
    from src.primary.apps._common.arr_api import check_connection as _check
    return _check(api_url, api_key, api_timeout, "sportarr", sportarr_logger)


def get_system_status(api_url: str, api_key: str, api_timeout: int) -> Dict:
    """Get Sportarr system status."""
    response = arr_request(api_url, api_key, api_timeout, "system/status", count_api=False)
    if response:
        return response
    return {}


def get_download_queue_size(api_url: str, api_key: str, api_timeout: int) -> int:
    """Get the current size of the Sportarr download queue."""
    retries = 2
    retry_delay = 3

    for attempt in range(retries + 1):
        try:
            endpoint = f"{api_url}/api/v3/queue?page=1&pageSize=1"

            verify_ssl = get_ssl_verify_setting()

            response = requests.get(endpoint, headers={"X-Api-Key": api_key}, timeout=api_timeout, verify=verify_ssl)
            response.raise_for_status()

            if not response.content:
                sportarr_logger.warning(f"Empty response when getting queue size (attempt {attempt+1}/{retries+1})")
                if attempt < retries:
                    time.sleep(retry_delay)
                    continue
                return -1

            try:
                queue_data = response.json()
                queue_size = queue_data.get('totalRecords', 0)
                sportarr_logger.debug(f"Sportarr download queue size: {queue_size}")
                return queue_size
            except json.JSONDecodeError as jde:
                sportarr_logger.error(f"Failed to decode queue JSON (attempt {attempt+1}/{retries+1}): {jde}")
                if attempt < retries:
                    time.sleep(retry_delay)
                    continue
                return -1

        except requests.exceptions.RequestException as e:
            sportarr_logger.error(f"Error getting Sportarr download queue size (attempt {attempt+1}/{retries+1}): {e}")
            if attempt < retries:
                sportarr_logger.info(f"Retrying in {retry_delay} seconds...")
                time.sleep(retry_delay)
                continue
            return -1
        except Exception as e:
            sportarr_logger.error(f"Unexpected error getting queue size (attempt {attempt+1}/{retries+1}): {e}")
            if attempt < retries:
                time.sleep(retry_delay)
                continue
            return -1

    sportarr_logger.error(f"All {retries+1} attempts to get download queue size failed")
    return -1


def get_items_with_missing(api_url: str, api_key: str, api_timeout: int, monitored_only: bool) -> List[Dict[str, Any]]:
    """Get a list of items with missing files (events not downloaded)."""
    try:
        sportarr_logger.debug("Retrieving missing items...")

        endpoint = "wanted/missing?pageSize=1000&sortKey=airDateUtc&sortDirection=descending"

        response = arr_request(api_url, api_key, api_timeout, endpoint, count_api=False)

        if response is None:
            return None

        items = []
        if isinstance(response, dict) and "records" in response:
            items = response["records"]

        if monitored_only:
            items = [item for item in items if item.get("monitored", False)]

        sportarr_logger.debug(f"Found {len(items)} missing items")
        return items

    except Exception as e:
        sportarr_logger.error(f"Error retrieving missing items: {str(e)}")
        return None


def get_cutoff_unmet_items(api_url: str, api_key: str, api_timeout: int, monitored_only: bool) -> List[Dict[str, Any]]:
    """Get a list of items that don't meet their quality profile cutoff."""
    try:
        sportarr_logger.debug("Retrieving cutoff unmet items...")

        endpoint = "wanted/cutoff?pageSize=1000&sortKey=airDateUtc&sortDirection=descending"

        response = arr_request(api_url, api_key, api_timeout, endpoint, count_api=False)

        if response is None:
            return None

        items = []
        if isinstance(response, dict) and "records" in response:
            items = response["records"]

        sportarr_logger.debug(f"Found {len(items)} cutoff unmet items")

        if monitored_only:
            items = [item for item in items if item.get("monitored", False)]
            sportarr_logger.debug(f"Found {len(items)} cutoff unmet items after filtering monitored")

        return items

    except Exception as e:
        sportarr_logger.error(f"Error retrieving cutoff unmet items: {str(e)}")
        return None


def item_search(api_url: str, api_key: str, api_timeout: int, item_ids: List[int]) -> int:
    """Trigger a search for one or more items."""
    try:
        from src.primary.stats_manager import check_hourly_cap_exceeded
        if check_hourly_cap_exceeded("sportarr"):
            sportarr_logger.warning(f"Sportarr API hourly limit reached - skipping item search for {len(item_ids)} items")
            return None
    except Exception as e:
        sportarr_logger.error(f"Error checking hourly API cap: {e}")

    try:
        sportarr_logger.debug(f"Searching for items with IDs: {item_ids}")

        payload = {
            "name": "EpisodeSearch",
            "episodeIds": item_ids
        }

        response = arr_request(api_url, api_key, api_timeout, "command", method="POST", data=payload)

        if response and "id" in response:
            command_id = response["id"]
            sportarr_logger.debug(f"Search command triggered with ID {command_id}")
            return command_id
        else:
            sportarr_logger.error("Failed to trigger search command - no command ID returned")
            return None

    except Exception as e:
        sportarr_logger.error(f"Error searching for items: {str(e)}")
        return None


def get_command_status(api_url: str, api_key: str, api_timeout: int, command_id: int) -> Optional[Dict]:
    """Get the status of a specific command."""
    if not command_id:
        sportarr_logger.error("No command ID provided for status check.")
        return None

    response = arr_request(api_url, api_key, api_timeout, f"command/{command_id}", count_api=False)
    if response:
        sportarr_logger.debug(f"Command {command_id} status: {response.get('status', 'unknown')}")
    return response


def get_series(api_url: str, api_key: str, api_timeout: int, series_id: Optional[int] = None) -> Union[List, Dict, None]:
    """Get series/league information from Sportarr."""
    if series_id is not None:
        endpoint = f"series/{series_id}"
    else:
        endpoint = "series"
    return arr_request(api_url, api_key, api_timeout, endpoint, count_api=False)


def get_tag_id_by_label(api_url: str, api_key: str, api_timeout: int, tag_label: str) -> Optional[int]:
    """Get tag ID by label (lookup only)."""
    try:
        response = arr_request(api_url, api_key, api_timeout, "tag", count_api=False)
        if response:
            for tag in response:
                if tag.get('label') == tag_label:
                    return tag.get('id')
        return None
    except Exception as e:
        sportarr_logger.error(f"Error getting tag '{tag_label}': {e}")
        return None


def get_exempt_tag_ids(api_url: str, api_key: str, api_timeout: int, exempt_tag_labels: list) -> dict:
    """Resolve exempt tag labels to tag IDs. Returns dict tag_id -> label."""
    if exempt_tag_labels is None:
        return {}
    if isinstance(exempt_tag_labels, str):
        exempt_tag_labels = [exempt_tag_labels]
    labels = [str(l).strip() for l in (exempt_tag_labels or []) if l is not None and str(l).strip()]
    if not labels:
        return {}
    result = {}
    for label in labels:
        tid = get_tag_id_by_label(api_url, api_key, api_timeout, label)
        if tid is not None:
            result[tid] = label
    return result


def get_or_create_tag(api_url: str, api_key: str, api_timeout: int, tag_label: str) -> Optional[int]:
    """Get existing tag ID or create a new tag in Sportarr."""
    try:
        response = arr_request(api_url, api_key, api_timeout, "tag", count_api=False)
        if response:
            for tag in response:
                if tag.get('label') == tag_label:
                    tag_id = tag.get('id')
                    sportarr_logger.debug(f"Found existing tag '{tag_label}' with ID: {tag_id}")
                    return tag_id

        tag_data = {"label": tag_label}
        response = arr_request(api_url, api_key, api_timeout, "tag", method="POST", data=tag_data, count_api=False)
        if response and 'id' in response:
            tag_id = response['id']
            sportarr_logger.info(f"Created new tag '{tag_label}' with ID: {tag_id}")
            return tag_id
        else:
            sportarr_logger.error(f"Failed to create tag '{tag_label}'. Response: {response}")
            return None

    except Exception as e:
        sportarr_logger.error(f"Error managing tag '{tag_label}': {e}")
        return None


def add_tag_to_series(api_url: str, api_key: str, api_timeout: int, series_id: int, tag_id: int) -> bool:
    """Add a tag to a series/league in Sportarr."""
    try:
        series_data = arr_request(api_url, api_key, api_timeout, f"series/{series_id}", count_api=False)
        if not series_data:
            sportarr_logger.error(f"Failed to get series data for ID: {series_id}")
            return False

        current_tags = series_data.get('tags', [])
        if tag_id in current_tags:
            sportarr_logger.debug(f"Tag {tag_id} already exists on series {series_id}")
            return True

        current_tags.append(tag_id)
        series_data['tags'] = current_tags

        response = arr_request(api_url, api_key, api_timeout, f"series/{series_id}", method="PUT", data=series_data, count_api=False)
        if response:
            sportarr_logger.debug(f"Successfully added tag {tag_id} to series {series_id}")
            return True
        else:
            sportarr_logger.error(f"Failed to update series {series_id} with tag {tag_id}")
            return False

    except Exception as e:
        sportarr_logger.error(f"Error adding tag {tag_id} to series {series_id}: {e}")
        return False


def tag_processed_series(api_url: str, api_key: str, api_timeout: int, series_id: int, tag_label: str = "sniparr-missing") -> bool:
    """Tag a series in Sportarr with the specified tag."""
    try:
        tag_id = get_or_create_tag(api_url, api_key, api_timeout, tag_label)
        if tag_id is None:
            sportarr_logger.error(f"Failed to get or create tag '{tag_label}' in Sportarr")
            return False

        success = add_tag_to_series(api_url, api_key, api_timeout, series_id, tag_id)
        if success:
            sportarr_logger.debug(f"Successfully tagged Sportarr series {series_id} with '{tag_label}'")
            return True
        else:
            sportarr_logger.error(f"Failed to add tag '{tag_label}' to Sportarr series {series_id}")
            return False

    except Exception as e:
        sportarr_logger.error(f"Error tagging Sportarr series {series_id} with '{tag_label}': {e}")
        return False


def get_quality_profiles(api_url: str, api_key: str, api_timeout: int) -> Optional[List[Dict]]:
    """Get all quality profiles configured in Sportarr."""
    try:
        sportarr_logger.debug("Fetching quality profiles from Sportarr...")

        profiles = arr_request(api_url, api_key, api_timeout, "qualityProfile", count_api=False)

        if profiles is None:
            sportarr_logger.error("Failed to retrieve quality profiles from Sportarr API.")
            return None

        sportarr_logger.debug(f"Found {len(profiles)} quality profiles in Sportarr")

        profile_names = [profile.get('name', 'Unknown') for profile in profiles]
        sportarr_logger.debug(f"Quality profiles: {', '.join(profile_names)}")

        return profiles

    except Exception as e:
        sportarr_logger.error(f"Error retrieving quality profiles: {str(e)}")
        return None
