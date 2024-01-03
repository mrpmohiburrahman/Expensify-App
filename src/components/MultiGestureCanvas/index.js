import React, {useContext, useEffect, useMemo, useRef} from 'react';
import {View} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {cancelAnimation, runOnUI, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withSpring} from 'react-native-reanimated';
import AttachmentCarouselPagerContext from '@components/Attachments/AttachmentCarousel/Pager/AttachmentCarouselPagerContext';
import useStyleUtils from '@hooks/useStyleUtils';
import useThemeStyles from '@hooks/useThemeStyles';
import getCanvasFitScale from './getCanvasFitScale';
import {defaultZoomRange, multiGestureCanvasDefaultProps, multiGestureCanvasPropTypes} from './propTypes';
import usePanGesture from './usePanGesture';
import usePinchGesture from './usePinchGesture';
import useTapGestures from './useTapGestures';
import * as MultiGestureCanvasUtils from './utils';

function getDeepDefaultProps({contentSize: contentSizeProp = {}, zoomRange: zoomRangeProp = {}}) {
    const contentSize = {
        width: contentSizeProp.width == null ? 1 : contentSizeProp.width,
        height: contentSizeProp.height == null ? 1 : contentSizeProp.height,
    };

    const zoomRange = {
        min: zoomRangeProp.min == null ? defaultZoomRange.min : zoomRangeProp.min,
        max: zoomRangeProp.max == null ? defaultZoomRange.max : zoomRangeProp.max,
    };

    return {contentSize, zoomRange};
}

function MultiGestureCanvas({canvasSize, isActive = true, onScaleChanged, children, ...props}) {
    const styles = useThemeStyles();
    const StyleUtils = useStyleUtils();
    const {contentSize, zoomRange} = getDeepDefaultProps(props);

    const attachmentCarouselPagerContext = useContext(AttachmentCarouselPagerContext);

    const pagerRefFallback = useRef(null);
    const {onTap, pagerRef, shouldPagerScroll, isSwipingInPager, onPinchGestureChange} = attachmentCarouselPagerContext || {
        onTap: () => undefined,
        onPinchGestureChange: () => undefined,
        pagerRef: pagerRefFallback,
        shouldPagerScroll: false,
        isSwipingInPager: false,
        ...props,
    };

    const {minScale: minContentScale, maxScale: maxContentScale} = useMemo(() => getCanvasFitScale({canvasSize, contentSize}), [canvasSize, contentSize]);

    const zoomScale = useSharedValue(1);

    // Adding together zoom scale and the initial scale to fit the content into the canvas
    // Using the minimum content scale, so that the image is not bigger than the canvas
    // and not smaller than needed to fit
    const totalScale = useDerivedValue(() => zoomScale.value * minContentScale, [minContentScale]);

    const panTranslateX = useSharedValue(0);
    const panTranslateY = useSharedValue(0);
    const panGestureRef = useRef(Gesture.Pan());

    const pinchScale = useSharedValue(1);
    const pinchTranslateX = useSharedValue(0);
    const pinchTranslateY = useSharedValue(0);

    // Total offset of the content including previous translations from panning and pinching gestures
    const offsetX = useSharedValue(0);
    const offsetY = useSharedValue(0);

    const stopAnimation = MultiGestureCanvasUtils.useWorkletCallback(() => {
        cancelAnimation(offsetX);
        cancelAnimation(offsetY);
    });

    const reset = MultiGestureCanvasUtils.useWorkletCallback((animated) => {
        pinchScale.value = 1;

        stopAnimation();

        pinchScale.value = 1;

        if (animated) {
            offsetX.value = withSpring(0, MultiGestureCanvasUtils.SPRING_CONFIG);
            offsetY.value = withSpring(0, MultiGestureCanvasUtils.SPRING_CONFIG);
            panTranslateX.value = withSpring(0, MultiGestureCanvasUtils.SPRING_CONFIG);
            panTranslateY.value = withSpring(0, MultiGestureCanvasUtils.SPRING_CONFIG);
            pinchTranslateX.value = withSpring(0, MultiGestureCanvasUtils.SPRING_CONFIG);
            pinchTranslateY.value = withSpring(0, MultiGestureCanvasUtils.SPRING_CONFIG);
            zoomScale.value = withSpring(1, MultiGestureCanvasUtils.SPRING_CONFIG);
            return;
        }

        offsetX.value = 0;
        offsetY.value = 0;
        panTranslateX.value = 0;
        panTranslateY.value = 0;
        pinchTranslateX.value = 0;
        pinchTranslateY.value = 0;
        zoomScale.value = 1;
    });

    const {singleTapGesture: basicSingleTapGesture, doubleTapGesture} = useTapGestures({
        canvasSize,
        contentSize,
        minContentScale,
        maxContentScale,
        panGestureRef,
        offsetX,
        offsetY,
        pinchScale,
        zoomScale,
        reset,
        stopAnimation,
        onScaleChanged,
        onTap,
    });
    const singleTapGesture = basicSingleTapGesture.requireExternalGestureToFail(doubleTapGesture, panGestureRef);

    const panGesture = usePanGesture({
        canvasSize,
        contentSize,
        zoomScale,
        totalScale,
        offsetX,
        offsetY,
        panTranslateX,
        panTranslateY,
        isSwipingInPager,
        stopAnimation,
    })
        .simultaneousWithExternalGesture(pagerRef, singleTapGesture, doubleTapGesture)
        .withRef(panGestureRef);

    const pinchGesture = usePinchGesture({
        canvasSize,
        zoomScale,
        zoomRange,
        offsetX,
        offsetY,
        pinchTranslateX,
        pinchTranslateY,
        pinchScale,
        isSwipingInPager,
        stopAnimation,
        onScaleChanged,
        onPinchGestureChange,
    }).simultaneousWithExternalGesture(panGesture, singleTapGesture, doubleTapGesture);

    // Enables/disables the pager scroll based on the zoom scale
    // When the content is zoomed in/out, the pager should be disabled
    useAnimatedReaction(
        () => zoomScale.value,
        () => {
            shouldPagerScroll.value = zoomScale.value === 1;
        },
    );

    const mounted = useRef(false);
    useEffect(() => {
        if (!mounted.current) {
            mounted.current = true;
            return;
        }

        if (!isActive) {
            runOnUI(reset)(false);
        }
    }, [isActive, mounted, reset]);

    const animatedStyles = useAnimatedStyle(() => {
        const x = pinchTranslateX.value + panTranslateX.value + offsetX.value;
        const y = pinchTranslateY.value + panTranslateY.value + offsetY.value;

        return {
            transform: [
                {
                    translateX: x,
                },
                {
                    translateY: y,
                },
                {scale: totalScale.value},
            ],
        };
    });

    return (
        <View
            collapsable={false}
            style={[
                styles.flex1,
                {
                    width: canvasSize.width,
                    overflow: 'hidden',
                },
            ]}
        >
            <GestureDetector gesture={Gesture.Simultaneous(pinchGesture, Gesture.Race(singleTapGesture, doubleTapGesture, panGesture))}>
                <View
                    collapsable={false}
                    style={StyleUtils.getFullscreenCenteredContentStyles()}
                >
                    <Animated.View
                        collapsable={false}
                        style={animatedStyles}
                    >
                        {children}
                    </Animated.View>
                </View>
            </GestureDetector>
        </View>
    );
}
MultiGestureCanvas.propTypes = multiGestureCanvasPropTypes;
MultiGestureCanvas.defaultProps = multiGestureCanvasDefaultProps;
MultiGestureCanvas.displayName = 'MultiGestureCanvas';

export default MultiGestureCanvas;
export {defaultZoomRange};
export {zoomScaleBounceFactors} from './utils';
