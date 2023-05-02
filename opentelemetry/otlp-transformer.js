/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/// <reference types="./otlp-transformer.d.ts" />

import * as core from './core.js';
import { hrTimeToNanoseconds } from './core.js';
import { ValueType } from './api.js';
import { DataPointType, AggregationTemporality } from './sdk-metrics.js';

var ESpanKind;
(function (ESpanKind) {
	ESpanKind[ESpanKind["SPAN_KIND_UNSPECIFIED"] = 0] = "SPAN_KIND_UNSPECIFIED";
	ESpanKind[ESpanKind["SPAN_KIND_INTERNAL"] = 1] = "SPAN_KIND_INTERNAL";
	ESpanKind[ESpanKind["SPAN_KIND_SERVER"] = 2] = "SPAN_KIND_SERVER";
	ESpanKind[ESpanKind["SPAN_KIND_CLIENT"] = 3] = "SPAN_KIND_CLIENT";
	ESpanKind[ESpanKind["SPAN_KIND_PRODUCER"] = 4] = "SPAN_KIND_PRODUCER";
	ESpanKind[ESpanKind["SPAN_KIND_CONSUMER"] = 5] = "SPAN_KIND_CONSUMER";
})(ESpanKind || (ESpanKind = {}));

function toAttributes(attributes) {
	return Object.keys(attributes).map(key => toKeyValue(key, attributes[key]));
}
function toKeyValue(key, value) {
	return {
		key: key,
		value: toAnyValue(value),
	};
}
function toAnyValue(value) {
	const t = typeof value;
	if (t === 'string')
		return { stringValue: value };
	if (t === 'number') {
		if (!Number.isInteger(value))
			return { doubleValue: value };
		return { intValue: value };
	}
	if (t === 'boolean')
		return { boolValue: value };
	if (value instanceof Uint8Array)
		return { bytesValue: value };
	if (Array.isArray(value))
		return { arrayValue: { values: value.map(toAnyValue) } };
	if (t === 'object' && value != null)
		return {
			kvlistValue: {
				values: Object.entries(value).map(([k, v]) => toKeyValue(k, v)),
			},
		};
	return {};
}

function sdkSpanToOtlpSpan(span, useHex) {
	const ctx = span.spanContext();
	const status = span.status;
	const parentSpanId = useHex
		? span.parentSpanId
		: span.parentSpanId != null
			? core.hexToBase64(span.parentSpanId)
			: undefined;
	return {
		traceId: useHex ? ctx.traceId : core.hexToBase64(ctx.traceId),
		spanId: useHex ? ctx.spanId : core.hexToBase64(ctx.spanId),
		parentSpanId: parentSpanId,
		traceState: ctx.traceState?.serialize(),
		name: span.name,
		kind: span.kind == null ? 0 : span.kind + 1,
		startTimeUnixNano: hrTimeToNanoseconds(span.startTime),
		endTimeUnixNano: hrTimeToNanoseconds(span.endTime),
		attributes: toAttributes(span.attributes),
		droppedAttributesCount: span.droppedAttributesCount,
		events: span.events.map(toOtlpSpanEvent),
		droppedEventsCount: span.droppedEventsCount,
		status: {
			code: status.code,
			message: status.message,
		},
		links: span.links.map(link => toOtlpLink(link, useHex)),
		droppedLinksCount: span.droppedLinksCount,
	};
}
function toOtlpLink(link, useHex) {
	return {
		attributes: link.attributes ? toAttributes(link.attributes) : [],
		spanId: useHex
			? link.context.spanId
			: core.hexToBase64(link.context.spanId),
		traceId: useHex
			? link.context.traceId
			: core.hexToBase64(link.context.traceId),
		traceState: link.context.traceState?.serialize(),
		droppedAttributesCount: link.droppedAttributesCount || 0,
	};
}
function toOtlpSpanEvent(timedEvent) {
	return {
		attributes: timedEvent.attributes
			? toAttributes(timedEvent.attributes)
			: [],
		name: timedEvent.name,
		timeUnixNano: hrTimeToNanoseconds(timedEvent.time),
		droppedAttributesCount: timedEvent.droppedAttributesCount || 0,
	};
}

function createExportTraceServiceRequest(spans, useHex) {
	return {
		resourceSpans: spanRecordsToResourceSpans(spans, useHex),
	};
}
function createResourceMap(readableSpans) {
	const resourceMap = new Map();
	for (const record of readableSpans) {
		let ilmMap = resourceMap.get(record.resource);
		if (!ilmMap) {
			ilmMap = new Map();
			resourceMap.set(record.resource, ilmMap);
		}
		const instrumentationLibraryKey = `${record.instrumentationLibrary.name}@${record.instrumentationLibrary.version || ''}:${record.instrumentationLibrary.schemaUrl || ''}`;
		let records = ilmMap.get(instrumentationLibraryKey);
		if (!records) {
			records = [];
			ilmMap.set(instrumentationLibraryKey, records);
		}
		records.push(record);
	}
	return resourceMap;
}
function spanRecordsToResourceSpans(readableSpans, useHex) {
	const resourceMap = createResourceMap(readableSpans);
	const out = [];
	const entryIterator = resourceMap.entries();
	let entry = entryIterator.next();
	while (!entry.done) {
		const [resource, ilmMap] = entry.value;
		const scopeResourceSpans = [];
		const ilmIterator = ilmMap.values();
		let ilmEntry = ilmIterator.next();
		while (!ilmEntry.done) {
			const scopeSpans = ilmEntry.value;
			if (scopeSpans.length > 0) {
				const { name, version, schemaUrl } = scopeSpans[0].instrumentationLibrary;
				const spans = scopeSpans.map(readableSpan => sdkSpanToOtlpSpan(readableSpan, useHex));
				scopeResourceSpans.push({
					scope: { name, version },
					spans: spans,
					schemaUrl: schemaUrl,
				});
			}
			ilmEntry = ilmIterator.next();
		}
		const transformedSpans = {
			resource: {
				attributes: toAttributes(resource.attributes),
				droppedAttributesCount: 0,
			},
			scopeSpans: scopeResourceSpans,
			schemaUrl: undefined,
		};
		out.push(transformedSpans);
		entry = entryIterator.next();
	}
	return out;
}

function toResourceMetrics(resourceMetrics) {
	return {
		resource: {
			attributes: toAttributes(resourceMetrics.resource.attributes),
			droppedAttributesCount: 0,
		},
		schemaUrl: undefined,
		scopeMetrics: toScopeMetrics(resourceMetrics.scopeMetrics),
	};
}
function toScopeMetrics(scopeMetrics) {
	return Array.from(scopeMetrics.map(metrics => {
		const scopeMetrics = {
			scope: {
				name: metrics.scope.name,
				version: metrics.scope.version,
			},
			metrics: metrics.metrics.map(metricData => toMetric(metricData)),
			schemaUrl: metrics.scope.schemaUrl,
		};
		return scopeMetrics;
	}));
}
function toMetric(metricData) {
	const out = {
		name: metricData.descriptor.name,
		description: metricData.descriptor.description,
		unit: metricData.descriptor.unit,
	};
	const aggregationTemporality = toAggregationTemporality(metricData.aggregationTemporality);
	if (metricData.dataPointType === DataPointType.SUM) {
		out.sum = {
			aggregationTemporality,
			isMonotonic: metricData.isMonotonic,
			dataPoints: toSingularDataPoints(metricData),
		};
	}
	else if (metricData.dataPointType === DataPointType.GAUGE) {
		out.gauge = {
			dataPoints: toSingularDataPoints(metricData),
		};
	}
	else if (metricData.dataPointType === DataPointType.HISTOGRAM) {
		out.histogram = {
			aggregationTemporality,
			dataPoints: toHistogramDataPoints(metricData),
		};
	}
	else if (metricData.dataPointType === DataPointType.EXPONENTIAL_HISTOGRAM) {
		out.exponentialHistogram = {
			aggregationTemporality,
			dataPoints: toExponentialHistogramDataPoints(metricData),
		};
	}
	return out;
}
function toSingularDataPoint(dataPoint, valueType) {
	const out = {
		attributes: toAttributes(dataPoint.attributes),
		startTimeUnixNano: hrTimeToNanoseconds(dataPoint.startTime),
		timeUnixNano: hrTimeToNanoseconds(dataPoint.endTime),
	};
	if (valueType === ValueType.INT) {
		out.asInt = dataPoint.value;
	}
	else if (valueType === ValueType.DOUBLE) {
		out.asDouble = dataPoint.value;
	}
	return out;
}
function toSingularDataPoints(metricData) {
	return metricData.dataPoints.map(dataPoint => {
		return toSingularDataPoint(dataPoint, metricData.descriptor.valueType);
	});
}
function toHistogramDataPoints(metricData) {
	return metricData.dataPoints.map(dataPoint => {
		const histogram = dataPoint.value;
		return {
			attributes: toAttributes(dataPoint.attributes),
			bucketCounts: histogram.buckets.counts,
			explicitBounds: histogram.buckets.boundaries,
			count: histogram.count,
			sum: histogram.sum,
			min: histogram.min,
			max: histogram.max,
			startTimeUnixNano: hrTimeToNanoseconds(dataPoint.startTime),
			timeUnixNano: hrTimeToNanoseconds(dataPoint.endTime),
		};
	});
}
function toExponentialHistogramDataPoints(metricData) {
	return metricData.dataPoints.map(dataPoint => {
		const histogram = dataPoint.value;
		return {
			attributes: toAttributes(dataPoint.attributes),
			count: histogram.count,
			min: histogram.min,
			max: histogram.max,
			sum: histogram.sum,
			positive: {
				offset: histogram.positive.offset,
				bucketCounts: histogram.positive.bucketCounts,
			},
			negative: {
				offset: histogram.negative.offset,
				bucketCounts: histogram.negative.bucketCounts,
			},
			scale: histogram.scale,
			zeroCount: histogram.zeroCount,
			startTimeUnixNano: hrTimeToNanoseconds(dataPoint.startTime),
			timeUnixNano: hrTimeToNanoseconds(dataPoint.endTime),
		};
	});
}
function toAggregationTemporality(temporality) {
	if (temporality === AggregationTemporality.DELTA) {
		return 1 ;
	}
	if (temporality === AggregationTemporality.CUMULATIVE) {
		return 2 ;
	}
	return 0 ;
}

function createExportMetricsServiceRequest(resourceMetrics) {
	return {
		resourceMetrics: resourceMetrics.map(metrics => toResourceMetrics(metrics)),
	};
}

export { ESpanKind, createExportMetricsServiceRequest, createExportTraceServiceRequest };
