#!/usr/bin/env python3

from flask import Blueprint, request, jsonify
import datetime, os, requests

from src.primary.state import reset_state_file
from src.primary.utils.logger import get_logger, APP_LOG_FILES
from src.primary.settings_manager import get_ssl_verify_setting
import traceback
import socket
from urllib.parse import urlparse
from src.primary.apps.sportarr import api as sportarr_api

sportarr_bp = Blueprint('sportarr', __name__)
sportarr_logger = get_logger("sportarr")


@sportarr_bp.route('/status', methods=['GET'])
def get_status():
    """Get the status of configured Sportarr instance"""
    try:
        from src.primary.settings_manager import load_settings
        settings = load_settings("sportarr")

        api_url = settings.get("url", "")
        api_key = settings.get("api_key", "")
        enabled = settings.get("enabled", True)

        connected_count = 0
        total_configured = 1 if api_url and api_key else 0

        if api_url and api_key and enabled:
            if sportarr_api.check_connection(api_url, api_key, 5):
                connected_count = 1

        return jsonify({
            "configured": total_configured > 0,
            "connected": connected_count > 0,
            "connected_count": connected_count,
            "total_configured": total_configured
        })
    except Exception as e:
        sportarr_logger.error(f"Error getting Sportarr status: {str(e)}")
        return jsonify({
            "configured": False,
            "connected": False,
            "error": str(e)
        }), 500


@sportarr_bp.route('/test-connection', methods=['POST'])
def test_connection():
    """Test connection to a Sportarr API instance"""
    data = request.json
    api_url = data.get('api_url')
    api_key = data.get('api_key')
    api_timeout = data.get('api_timeout', 30)

    if not api_url or not api_key:
        return jsonify({"success": False, "message": "API URL and API Key are required"}), 400

    if not (api_url.startswith('http://') or api_url.startswith('https://')):
        sportarr_logger.warning(f"API URL missing http(s) scheme: {api_url}")
        api_url = f"http://{api_url}"
        sportarr_logger.debug(f"Auto-correcting URL to: {api_url}")

    parsed_url = urlparse(api_url)
    hostname = parsed_url.hostname
    port = parsed_url.port or (443 if parsed_url.scheme == 'https' else 80)

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(3)
        result = sock.connect_ex((hostname, port))
        sock.close()

        if result != 0:
            error_msg = f"Connection refused - Unable to connect to {hostname}:{port}. Please check if the server is running and the port is correct."
            sportarr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), 404
    except socket.gaierror:
        error_msg = f"DNS resolution failed - Cannot resolve hostname: {hostname}. Please check your URL."
        sportarr_logger.error(error_msg)
        return jsonify({"success": False, "message": error_msg}), 404
    except Exception as e:
        sportarr_logger.debug(f"Socket test error, continuing with full request: {str(e)}")

    url = f"{api_url.rstrip('/')}/api/v3/system/status"
    headers = {
        "X-Api-Key": api_key,
        "Content-Type": "application/json"
    }

    verify_ssl = get_ssl_verify_setting()

    if not verify_ssl:
        sportarr_logger.debug("SSL verification disabled by user setting for connection test")

    try:
        response = requests.get(url, headers=headers, timeout=(10, api_timeout), verify=verify_ssl)

        if response.status_code == 401:
            error_msg = "Authentication failed: Invalid API key"
            sportarr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), 200
        elif response.status_code == 403:
            error_msg = "Access forbidden: Check API key permissions"
            sportarr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), 200
        elif response.status_code == 404:
            error_msg = "API endpoint not found: This doesn't appear to be a valid Sportarr server. Check your URL."
            sportarr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), 404
        elif response.status_code >= 500:
            error_msg = f"Sportarr server error (HTTP {response.status_code}): The Sportarr server is experiencing issues"
            sportarr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), 200

        response.raise_for_status()

        try:
            response_data = response.json()
            version = response_data.get('version', 'unknown')

            return jsonify({
                "success": True,
                "message": f"Successfully connected to Sportarr v{version}",
                "version": version
            })
        except ValueError:
            error_msg = "Invalid JSON response from Sportarr API - This doesn't appear to be a valid Sportarr server"
            sportarr_logger.error(f"{error_msg}. Response content: {response.text[:200]}")
            return jsonify({"success": False, "message": error_msg}), 500

    except requests.exceptions.ConnectionError as e:
        error_details = str(e)
        if "Connection refused" in error_details:
            error_msg = f"Connection refused - Sportarr is not running on {api_url} or the port is incorrect"
        elif "Name or service not known" in error_details or "getaddrinfo failed" in error_details:
            error_msg = f"DNS resolution failed - Cannot find host '{urlparse(api_url).hostname}'. Check your URL."
        else:
            error_msg = f"Connection error - Check if Sportarr is running: {error_details}"

        sportarr_logger.error(error_msg)
        return jsonify({"success": False, "message": error_msg}), 404
    except requests.exceptions.Timeout:
        error_msg = "Connection timed out - Sportarr took too long to respond"
        sportarr_logger.error(error_msg)
        return jsonify({"success": False, "message": error_msg}), 504
    except requests.exceptions.RequestException as e:
        error_msg = f"Connection test failed: {str(e)}"
        sportarr_logger.error(error_msg)
        return jsonify({"success": False, "message": error_msg}), 500


@sportarr_bp.route('/versions', methods=['GET'])
def get_versions():
    """Get the version information from the Sportarr API"""
    try:
        from src.primary.settings_manager import load_settings
        settings = load_settings("sportarr")

        api_url = settings.get("url", "")
        api_key = settings.get("api_key", "")
        enabled = settings.get("enabled", True)
        instance_name = settings.get("name", "Default")

        if not api_url or not api_key:
            return jsonify({"success": False, "message": "No Sportarr instance configured"}), 404

        if not enabled:
            return jsonify({"success": False, "message": "Sportarr instance is disabled"}), 404

        version_url = f"{api_url.rstrip('/')}/api/v3/system/status"
        headers = {"X-Api-Key": api_key}

        try:
            response = requests.get(version_url, headers=headers, timeout=10)

            if response.status_code == 200:
                version_data = response.json()
                version = version_data.get("version", "Unknown")
                result = {
                    "name": instance_name,
                    "success": True,
                    "version": version
                }
            else:
                result = {
                    "name": instance_name,
                    "success": False,
                    "message": f"Failed to get version information: HTTP {response.status_code}"
                }
        except requests.exceptions.RequestException as e:
            result = {
                "name": instance_name,
                "success": False,
                "message": f"Connection error: {str(e)}"
            }

        return jsonify({"success": True, "results": [result]})
    except Exception as e:
        sportarr_logger.error(f"Error getting Sportarr versions: {str(e)}")
        return jsonify({"success": False, "message": str(e)}), 500


@sportarr_bp.route('/logs', methods=['GET'])
def get_logs():
    """Get the log file for Sportarr"""
    try:
        log_file = APP_LOG_FILES.get("sportarr")

        if not log_file or not os.path.exists(log_file):
            return jsonify({"success": False, "message": "Log file not found"}), 404

        with open(log_file, 'r') as f:
            lines = f.readlines()
            log_content = ''.join(lines[-200:])

        return jsonify({"success": True, "logs": log_content})
    except Exception as e:
        error_message = f"Error fetching Sportarr logs: {str(e)}"
        sportarr_logger.error(error_message)
        traceback.print_exc()
        return jsonify({"success": False, "message": error_message}), 500


@sportarr_bp.route('/clear-processed', methods=['POST'])
def clear_processed():
    """Clear the processed missing and upgrade files for Sportarr"""
    try:
        sportarr_logger.info("Clearing processed missing items state")
        reset_state_file("sportarr", "processed_missing")

        sportarr_logger.info("Clearing processed quality upgrade state")
        reset_state_file("sportarr", "processed_upgrades")

        return jsonify({
            "success": True,
            "message": "Successfully cleared Sportarr processed state"
        })
    except Exception as e:
        error_message = f"Error clearing Sportarr processed state: {str(e)}"
        sportarr_logger.error(error_message)
        return jsonify({"success": False, "message": error_message}), 500
