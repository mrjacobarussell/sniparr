"""
Sportarr app module for Sniparr
Contains functionality for missing items and quality upgrades in Sportarr (Sports PVR)
"""

from src.primary.apps.sportarr.missing import process_missing_items
from src.primary.apps.sportarr.upgrade import process_cutoff_upgrades
from src.primary.settings_manager import load_settings
from src.primary.utils.logger import get_logger

sportarr_logger = get_logger("sportarr")


def get_configured_instances(quiet=False):
    """Get all configured and enabled Sportarr instances"""
    settings = load_settings("sportarr")
    instances = []

    if not settings:
        if not quiet:
            sportarr_logger.debug("No settings found for Sportarr")
        return instances

    if "instances" in settings and isinstance(settings["instances"], list) and settings["instances"]:
        for idx, instance in enumerate(settings["instances"]):

            api_url = instance.get("api_url", "").strip()
            api_key = instance.get("api_key", "").strip()

            if api_url and not (api_url.startswith('http://') or api_url.startswith('https://')):
                if not quiet:
                    sportarr_logger.debug(f"Instance '{instance.get('name', 'Unnamed')}' has URL without http(s) scheme: {api_url}")
                api_url = f"http://{api_url}"
                if not quiet:
                    sportarr_logger.debug(f"Auto-correcting URL to: {api_url}")

            is_enabled = instance.get("enabled", True)

            if is_enabled and api_url and api_key:
                raw = instance.get("name", "Default") or "Default"
                instance_name = (raw.strip() if isinstance(raw, str) else "Default") or "Default"

                instance_id = instance.get("instance_id")
                if not instance_id:
                    from src.primary.utils.instance_id import generate_instance_id
                    from src.primary.settings_manager import save_settings
                    from src.primary.utils.database import get_database
                    existing_ids = {inst.get("instance_id") for inst in settings["instances"] if isinstance(inst, dict) and inst.get("instance_id")}
                    instance_id = generate_instance_id("sportarr", existing_ids)
                    settings["instances"][idx]["instance_id"] = instance_id
                    save_settings("sportarr", settings)
                    get_database().migrate_instance_identifier("sportarr", instance_name, instance_id)
                    instance["instance_id"] = instance_id

                instance_data = {
                    "instance_id": instance_id,
                    "instance_name": instance_name,
                    "api_url": api_url,
                    "api_key": api_key,
                    "swaparr_enabled": instance.get("swaparr_enabled", False),
                    "hunt_missing_items": instance.get("hunt_missing_items", 1),
                    "hunt_upgrade_items": instance.get("hunt_upgrade_items", 0),
                    "upgrade_selection_method": (instance.get("upgrade_selection_method") or "cutoff").strip().lower(),
                    "upgrade_tag": (instance.get("upgrade_tag") or "").strip(),
                    "sleep_duration": instance.get("sleep_duration", settings.get("sleep_duration", 900)),
                    "hourly_cap": instance.get("hourly_cap", settings.get("hourly_cap", 20)),
                    "exempt_tags": instance.get("exempt_tags") or [],
                    "state_management_hours": instance.get("state_management_hours", 72),
                    "state_management_mode": instance.get("state_management_mode", "custom"),
                    "api_timeout": instance.get("api_timeout", 120),
                    "command_wait_delay": instance.get("command_wait_delay", 1),
                    "command_wait_attempts": instance.get("command_wait_attempts", 600),
                    "max_download_queue_size": instance.get("max_download_queue_size", -1),
                    "max_seed_queue_size": instance.get("max_seed_queue_size", -1),
                    "seed_check_torrent_client": instance.get("seed_check_torrent_client"),
                    "tag_processed_items": instance.get("tag_processed_items", False),
                    "tag_enable_missing": instance.get("tag_enable_missing", False),
                    "tag_enable_upgrade": instance.get("tag_enable_upgrade", False),
                    "tag_enable_upgraded": instance.get("tag_enable_upgraded", False),
                    "custom_tags": instance.get("custom_tags", {}),
                }
                instances.append(instance_data)
            elif not is_enabled:
                if not quiet:
                    sportarr_logger.debug(f"Skipping disabled instance: {instance.get('name', 'Unnamed')}")
            else:
                instance_name = instance.get('name', 'Unnamed')
                if instance_name == 'Default':
                    pass
                else:
                    if not quiet:
                        sportarr_logger.warning(f"Skipping instance '{instance_name}' due to missing API URL or key (URL: '{api_url}', Key Set: {bool(api_key)})")
    else:
        if not quiet:
            sportarr_logger.debug("No instances configured")

    return instances

__all__ = ["process_missing_items", "process_cutoff_upgrades", "get_configured_instances"]
