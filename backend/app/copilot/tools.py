"""Tool (function-calling) schemas exposed to the Copilot's LLM, plus the
name -> app.copilot.data_access function dispatch table used to actually
execute a call the model requests. This file is the LLM-facing contract;
app.copilot.data_access is the only thing it's allowed to call into - no
tool function here ever touches app.live/app.services/app.state directly.
"""
from app.copilot import data_access

TOOL_SCHEMAS = [
    {
        'type': 'function',
        'function': {
            'name': 'get_fleet_overview',
            'description': (
                'THE STARTING POINT for any broad or multi-batch question - "what\'s running", "which batch '
                'needs attention", "any critical batches", comparisons across batches, etc. Returns every '
                'running batch\'s status, a condensed KPI-prediction status, and its top open alerts in ONE '
                'call. Always try this first and see if it already answers the question before reaching for '
                'any of the single-batch tools below - it is much cheaper than calling those per batch.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'plant': {'type': 'string', 'description': 'Optional plant name to filter by.'},
                },
                'required': [],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'get_running_batch_status',
            'description': 'Get one specific, already-identified running batch\'s current status: phase, elapsed/target minutes, scenario profile, drifting parameter. Prefer get_fleet_overview unless you already know the exact batch id you need.',
            'parameters': {
                'type': 'object',
                'properties': {'running_batch_id': {'type': 'string'}},
                'required': ['running_batch_id'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'get_latest_kpi_prediction',
            'description': (
                'Get the FULL KPI Prediction Agent detail (including its LLM-generated summary/explanation '
                'text and per-parameter formula breakdown) for ONE specific, already-identified running '
                'batch. Only call this when the user wants the detailed reasoning behind a KPI for a '
                'particular batch - get_fleet_overview already has a condensed status for a broad question. '
                'Null if the batch has under 30 minutes of history.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {'running_batch_id': {'type': 'string'}},
                'required': ['running_batch_id'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'get_latest_parameter_assessments',
            'description': (
                'Get the Process Parameter Deviation Agent\'s latest per-parameter assessment for ONE '
                'specific, already-identified running batch - current/predicted status, root cause, and '
                'recommended action for each of the 12 process parameters. Only call for a batch the user is '
                'specifically asking about.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {'running_batch_id': {'type': 'string'}},
                'required': ['running_batch_id'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'get_active_alerts',
            'description': (
                'Get the FULL open (unresolved) alert detail for ONE specific, already-identified running '
                'batch. get_fleet_overview already includes each batch\'s top 2 alerts - only call this if '
                'you need every open alert for one particular batch, not for a broad/multi-batch question.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {'running_batch_id': {'type': 'string'}},
                'required': ['running_batch_id'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'get_recent_telemetry',
            'description': (
                'Get the trailing window of raw process-parameter sensor readings for ONE specific batch. '
                'This is relatively large - only call it when the user explicitly asks about raw parameter '
                'trends/actual sensor values over time, never for a general status or attention question.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'running_batch_id': {'type': 'string'},
                    'minutes': {'type': 'integer', 'description': 'How many trailing minutes to return (default 10).'},
                },
                'required': ['running_batch_id'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'get_historical_batch_kpis',
            'description': (
                'Get the real recorded final KPIs for a completed/historical batch id (e.g. "PAR-042", or '
                '"PAR-GOLDEN" for the golden/reference batch) - use this to compare a running batch against '
                'history or against the golden batch.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {'batch_id': {'type': 'string'}},
                'required': ['batch_id'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'get_plant_kpi_rollup',
            'description': (
                'Get plant-level KPI numbers for a plant, from completed historical batches only. Omit '
                '"group_by" for the ALL-TIME rollup (OEE/Quality/Process Stability average + total energy). '
                'Pass group_by=\'shift\'|\'day\'|\'month\' to get the SAME numbers as the dashboard\'s Current '
                'Shift / Today / This Month cards - omit "period" for the current one. Pass a specific '
                '"period" ("YYYY-MM-DD" for day, "YYYY-MM" for month) to look up a past day/month instead '
                '(shift has no historical lookup - always current). "batch_count" is always how many completed '
                'historical batches (within whatever scope was requested) were counted - never running '
                'batches; use get_fleet_overview for currently running batches.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'plant': {'type': 'string'},
                    'group_by': {
                        'type': 'string',
                        'enum': ['shift', 'day', 'month'],
                        'description': 'Omit for the all-time rollup. Otherwise scopes to the current (or a specific) shift/day/month.',
                    },
                    'period': {
                        'type': 'string',
                        'description': (
                            'Optional specific past period instead of the current one: "YYYY-MM-DD" when '
                            'group_by="day", or "YYYY-MM" when group_by="month". Ignored/unsupported for group_by="shift".'
                        ),
                    },
                },
                'required': ['plant'],
            },
        },
    },
]

TOOL_DISPATCH = {
    'get_fleet_overview': data_access.get_fleet_overview,
    'get_running_batch_status': data_access.get_running_batch_status,
    'get_latest_kpi_prediction': data_access.get_latest_kpi_prediction,
    'get_latest_parameter_assessments': data_access.get_latest_parameter_assessments,
    'get_active_alerts': data_access.get_active_alerts,
    'get_recent_telemetry': data_access.get_recent_telemetry,
    'get_historical_batch_kpis': data_access.get_historical_batch_kpis,
    'get_plant_kpi_rollup': data_access.get_plant_kpi_rollup,
}
