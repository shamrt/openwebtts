<script lang="ts">
	import { Select as SelectPrimitive } from "$lib/vendor/bits-ui/dist/index.js";

	let { ...restProps }: SelectPrimitive.PortalProps = $props();
</script>

<SelectPrimitive.Portal {...restProps} />
