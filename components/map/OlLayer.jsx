/**
 * Copyright 2015, GeoSolutions Sas.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */
import React from 'react';
import {connect} from 'react-redux';
import PropTypes from 'prop-types';
import isEqual from 'lodash.isequal';
import omit from 'lodash.omit';
import ol from 'openlayers';
import {setLayerLoading} from '../../actions/layers';
import LayerRegistry from './layers/index';

class OlLayer extends React.Component {
    static propTypes = {
        map: PropTypes.object,
        options: PropTypes.object,
        projection: PropTypes.string,
        setLayerLoading: PropTypes.func,
        swipe: PropTypes.number,
        zIndex: PropTypes.number
    }
    state = {
        layer: null
    }
    componentDidMount() {
        this.tilestoload = 0;
        this.createLayer(this.makeOptions(this.props.options));
    }
    componentDidUpdate(prevProps, prevState) {
        if (!this.state.layer) {
            return;
        }
        const newOptions = this.makeOptions(this.props.options);
        const oldOptions = this.makeOptions(prevProps.options);

        this.state.layer.setVisible(newOptions.visibility);
        this.state.layer.setOpacity(newOptions.opacity / 255.0);
        this.state.layer.setZIndex(newOptions.zIndex);
        this.updateLayer(newOptions, oldOptions);

        if (this.props.swipe !== prevProps.swipe) {
            this.props.map.render();
        }
    }
    componentWillUnmount() {
        if (this.state.layer && this.props.map) {
            this.props.map.removeLayer(this.state.layer);
        }
    }
    render() {
        const layerCreator = LayerRegistry[this.props.options.type];
        if (this.state.layer && layerCreator && layerCreator.render) {
            return layerCreator.render(this.props.options, this.props.map, this.state.layer);
        }
        return null;
    }
    makeOptions = (options) => {
        return {
            ...options,
            projection: options.srs || options.crs || options.projection || this.props.projection,
            opacity: options.opacity !== undefined ? options.opacity : 255
        };
    }
    createLayer = (options) => {
        let layer = null;
        if (options.type === 'group') {
            layer = new ol.layer.Group({zIndex: this.props.options.zIndex});
            layer.setLayers(new ol.Collection(options.items.map(item => {
                const layerCreator = LayerRegistry[item.type];
                if (layerCreator) {
                    const sublayer = layerCreator.create(this.makeOptions(item), this.props.map);
                    layer.set('id', options.id + "#" + item.name);
                    return sublayer;
                } else {
                    return null;
                }
            }).filter(x => x)));
        } else {
            const layerCreator = LayerRegistry[options.type];
            if (layerCreator) {
                layer = layerCreator.create(options, this.props.map);
            }
        }
        if (layer) {
            layer.set('id', options.id);
            layer.setVisible(options.visibility);
            layer.setOpacity(options.opacity / 255.0);
            layer.setZIndex(this.props.zIndex);
            this.addLayer(layer, options);
            this.setState({layer: layer});
        }
    }
    updateLayer = (newOptions, oldOptions) => {
        // optimization to avoid to update the layer if not necessary
        if (isEqual(omit(newOptions, ["loading"]), omit(oldOptions, ["loading"]) ) ) {
            return;
        }
        const layerCreator = LayerRegistry[this.props.options.type];
        if (layerCreator && layerCreator.update) {
            layerCreator.update(
                this.state.layer,
                newOptions,
                oldOptions,
                this.props.map
            );
        }
    }
    addLayer = (layer, options) => {
        this.props.map.addLayer(layer);
        layer.on('precompose', (event) => {
            const ctx = event.context;
            ctx.save();
            ctx.beginPath();
            if (this.props.swipe) {
                const width = ctx.canvas.width * (this.props.swipe / 100);
                ctx.rect(0, 0, width, ctx.canvas.height);
                ctx.clip();
            }
        });

        layer.on('postcompose', (event) => {
            event.context.restore();
        });

        if (options.zoomToExtent && layer.getSource()) {
            const map = this.props.map;
            const source = layer.getSource();
            source.once('change', () => {
                if (source.getState() === 'ready') {
                    if (source.getFeatures().length > 0) {
                        map.getView().fit(source.getExtent(), map.getSize());
                    }
                }
            });
        }
        const sublayers = {};
        if (layer instanceof ol.layer.Group) {
            layer.getLayers().forEach(sublayer => {
                sublayers[options.id + "#" + sublayer.get('id')] = sublayer;
            });
        } else {
            sublayers[options.id] = layer;
        }
        Object.entries(sublayers).map(([id, sublayer]) => {
            if (!sublayer.getTileLoadFunction) {
                sublayer.getSource().on('imageloadstart', () => {
                    this.props.setLayerLoading(id, true);
                });
                sublayer.getSource().on('imageloadend', () => {
                    this.props.setLayerLoading(id, false);
                });
                sublayer.getSource().on('imageloaderror', () => {
                    this.props.setLayerLoading(id, false);
                });
            } else {
                sublayer.getSource().on('tileloadstart', () => {
                    if (this.tilestoload === 0) {
                        this.props.setLayerLoading(id, true);
                    }
                    this.tilestoload++;
                });
                sublayer.getSource().on('tileloadend', () => {
                    this.tilestoload--;
                    if (this.tilestoload === 0) {
                        this.props.setLayerLoading(id, false);
                    }
                });
                sublayer.getSource().on('tileloaderror', () => {
                    this.tilestoload--;
                    if (this.tilestoload === 0) {
                        this.props.setLayerLoading(id, false);
                    }
                });
            }
        });
    }
}

export default connect(() => ({}), {
    setLayerLoading: setLayerLoading
})(OlLayer);
